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

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on knowledge_base, chunks from anon, authenticated;
  end if;
end;
$$;
