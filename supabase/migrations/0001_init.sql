create extension if not exists vector;
create extension if not exists pgcrypto;

create table knowledge_base (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('NOTE', 'URL')),
  source_url text,
  title text,
  raw_content text,
  content_hash text,
  status text not null default 'SUBMITTED'
    check (status in ('SUBMITTED', 'PROCESSING', 'FAILED', 'READY')),
  error_message text,
  retry_count int not null default 0 check (retry_count >= 0),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  modified_at timestamptz not null default now(),
  constraint knowledge_base_url_has_source_url check (type <> 'URL' or source_url is not null),
  constraint knowledge_base_note_has_content_hash check (type <> 'NOTE' or content_hash is not null)
);

create unique index knowledge_base_source_url_key on knowledge_base (source_url);
create unique index knowledge_base_content_hash_key on knowledge_base (content_hash);
create index knowledge_base_status_created_at_idx on knowledge_base (status, created_at);

create function set_modified_at() returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.modified_at = now();
  return new;
end;
$$;

create trigger knowledge_base_set_modified_at
before update on knowledge_base
for each row execute function set_modified_at();

create table chunks (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references knowledge_base (id) on delete cascade,
  chunk_index int not null,
  content text not null,
  embedding vector(1024) not null,
  created_at timestamptz not null default now(),
  unique (item_id, chunk_index)
);

create index chunks_embedding_idx on chunks using hnsw (embedding vector_cosine_ops);

alter table knowledge_base enable row level security;
alter table chunks enable row level security;

create function claim_jobs(batch int) returns setof knowledge_base
language sql
set search_path = public, extensions
as $$
  with picked as (
    select id from knowledge_base
    where status = 'SUBMITTED' and deleted_at is null
    order by created_at
    limit batch
    for update skip locked
  )
  update knowledge_base kb
  set status = 'PROCESSING'
  from picked
  where kb.id = picked.id
  returning kb.*;
$$;

create function reset_stuck_jobs(stuck_minutes int, max_retries int) returns setof knowledge_base
language sql
set search_path = public, extensions
as $$
  update knowledge_base
  set retry_count = retry_count + 1,
      status = case when retry_count + 1 <= max_retries then 'SUBMITTED' else 'FAILED' end,
      error_message = case
        when retry_count + 1 <= max_retries then error_message
        else 'Processing timed out'
      end
  where status = 'PROCESSING'
    and modified_at < now() - make_interval(mins => stuck_minutes)
  returning *;
$$;

create function match_chunks(query_embedding vector(1024), match_count int, min_similarity float)
returns table (
  id uuid,
  item_id uuid,
  content text,
  similarity float,
  type text,
  title text,
  source_url text
)
language sql stable
set search_path = public, extensions
set hnsw.iterative_scan = strict_order
as $$
  select c.id, c.item_id, c.content, 1 - (c.embedding <=> query_embedding),
         kb.type, kb.title, kb.source_url
  from chunks c
  join knowledge_base kb on kb.id = c.item_id
  where kb.status = 'READY'
    and kb.deleted_at is null
    and 1 - (c.embedding <=> query_embedding) >= min_similarity
  order by c.embedding <=> query_embedding
  limit match_count;
$$;

revoke all on function claim_jobs(int) from public;
revoke all on function reset_stuck_jobs(int, int) from public;
revoke all on function match_chunks(vector, int, float) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on knowledge_base, chunks from anon, authenticated;
    revoke all on function claim_jobs(int), reset_stuck_jobs(int, int),
      match_chunks(vector, int, float) from anon, authenticated;
  end if;
end;
$$;
