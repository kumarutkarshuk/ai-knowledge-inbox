import type pg from "pg";
import type { ItemStatus } from "./types/api.js";
import { DB_QUERY_TIMEOUT_MS, EMBEDDING_DIMS } from "./constants.js";
import { withTransaction, type KnowledgeBaseRow, type MatchChunkRow } from "./db.js";

type Queryable = pg.Pool | pg.PoolClient;

const CLAIM_JOBS_SQL = `
  with picked as (
    select id from knowledge_base
    where status = 'SUBMITTED' and deleted_at is null
    order by created_at
    limit $1
    for update skip locked
  ),
  claimed as (
    update knowledge_base kb
    set status = 'PROCESSING'
    from picked
    where kb.id = picked.id
    returning kb.*
  )
  select * from claimed order by created_at`;

const RESET_STUCK_JOBS_SQL = `
  update knowledge_base
  set retry_count = retry_count + 1,
      status = case when retry_count + 1 <= $2 then 'SUBMITTED' else 'FAILED' end,
      error_message = case
        when retry_count + 1 <= $2 then error_message
        else 'Processing timed out'
      end
  where status = 'PROCESSING'
    and modified_at < now() - make_interval(mins => $1)
  returning *`;

const MATCH_CHUNKS_SQL = `
  select c.id, c.item_id, c.content, 1 - (c.embedding <=> $1::vector) as similarity,
         kb.type, kb.title, kb.source_url
  from chunks c
  join knowledge_base kb on kb.id = c.item_id
  where kb.status = 'READY'
    and kb.deleted_at is null
    and 1 - (c.embedding <=> $1::vector) >= $3
  order by c.embedding <=> $1::vector
  limit $2`;

function assertCount(name: string, value: number) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer, got ${value}`);
  }
}

export async function claimJobs(db: Queryable, batch: number): Promise<KnowledgeBaseRow[]> {
  assertCount("batch", batch);
  const { rows } = await db.query<KnowledgeBaseRow>(CLAIM_JOBS_SQL, [batch]);
  return rows;
}

export async function resetStuckJobs(
  db: Queryable,
  stuckMinutes: number,
  maxRetries: number,
): Promise<KnowledgeBaseRow[]> {
  assertCount("stuckMinutes", stuckMinutes);
  assertCount("maxRetries", maxRetries);
  const { rows } = await db.query<KnowledgeBaseRow>(RESET_STUCK_JOBS_SQL, [
    stuckMinutes,
    maxRetries,
  ]);
  return rows;
}

export async function matchChunks(
  pool: pg.Pool,
  embedding: number[],
  matchCount: number,
  minSimilarity: number,
): Promise<MatchChunkRow[]> {
  assertCount("matchCount", matchCount);
  if (embedding.length !== EMBEDDING_DIMS || !embedding.every(Number.isFinite)) {
    throw new Error(`embedding must have ${EMBEDDING_DIMS} finite numbers`);
  }
  return withTransaction(pool, async (client) => {
    await client.query(
      `set local hnsw.iterative_scan = strict_order; set local statement_timeout = ${DB_QUERY_TIMEOUT_MS}`,
    );
    const { rows } = await client.query<MatchChunkRow>(MATCH_CHUNKS_SQL, [
      JSON.stringify(embedding),
      matchCount,
      minSimilarity,
    ]);
    return rows;
  });
}

export async function saveUrlContent(
  db: Queryable,
  id: string,
  page: { title: string | null; content: string },
): Promise<void> {
  await db.query(
    `update knowledge_base set title = coalesce($2, title), raw_content = $3
     where id = $1 and status = 'PROCESSING'`,
    [id, page.title, page.content],
  );
}

export async function saveChunksAndMarkReady(
  client: pg.PoolClient,
  id: string,
  chunks: { content: string; embedding: number[] }[],
): Promise<boolean> {
  const { rowCount } = await client.query(
    `update knowledge_base set status = 'READY', error_message = null
     where id = $1 and status = 'PROCESSING'`,
    [id],
  );
  if (!rowCount) return false;
  await client.query("delete from chunks where item_id = $1", [id]);
  await client.query(
    `insert into chunks (item_id, chunk_index, content, embedding)
     select $1, t.i - 1, t.content, t.embedding::vector
     from unnest($2::text[], $3::text[]) with ordinality as t(content, embedding, i)`,
    [id, chunks.map((c) => c.content), chunks.map((c) => JSON.stringify(c.embedding))],
  );
  return true;
}

export async function recordJobFailure(
  db: Queryable,
  id: string,
  failure: { retryCount: number; status: ItemStatus; errorMessage: string },
): Promise<void> {
  await db.query(
    `update knowledge_base set retry_count = $2, status = $3, error_message = $4
     where id = $1 and status = 'PROCESSING'`,
    [id, failure.retryCount, failure.status, failure.errorMessage],
  );
}

export async function releaseJob(db: Queryable, id: string): Promise<void> {
  await db.query(
    "update knowledge_base set status = 'SUBMITTED' where id = $1 and status = 'PROCESSING'",
    [id],
  );
}
