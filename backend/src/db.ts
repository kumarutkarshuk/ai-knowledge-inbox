import pg from "pg";
import { DB_CONNECT_TIMEOUT_MS } from "./constants.js";
import type { ItemStatus, ItemType } from "./types/api.js";

export function createPool(databaseUrl: string, ssl = true): pg.Pool {
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    ssl: ssl ? { rejectUnauthorized: false } : false,
    connectionTimeoutMillis: DB_CONNECT_TIMEOUT_MS,
  });
  pool.on("error", (err) => {
    console.error(`Idle database client error: ${err.message}`);
  });
  return pool;
}

export async function withTransaction<T>(
  pool: pg.Pool,
  work: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  const onError = (err: Error) => console.error(`Database client error: ${err.message}`);
  client.on("error", onError);
  let broken: Error | undefined;
  try {
    await client.query("begin");
    const result = await work(client);
    await client.query("commit");
    return result;
  } catch (err) {
    broken = await client.query("rollback").then(
      () => undefined,
      (rollbackErr: Error) => rollbackErr,
    );
    throw err;
  } finally {
    client.off("error", onError);
    client.release(broken);
  }
}

export interface KnowledgeBaseRow {
  id: string;
  type: ItemType;
  source_url: string | null;
  title: string | null;
  raw_content: string | null;
  content_hash: string | null;
  status: ItemStatus;
  error_message: string | null;
  retry_count: number;
  deleted_at: Date | null;
  created_at: Date;
  modified_at: Date;
}

export interface ChunkRow {
  id: string;
  item_id: string;
  chunk_index: number;
  content: string;
  embedding: string;
  created_at: Date;
}

export interface MatchChunkRow {
  id: string;
  item_id: string;
  content: string;
  similarity: number;
  type: ItemType;
  title: string | null;
  source_url: string | null;
}
