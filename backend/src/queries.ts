import type pg from "pg";
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
