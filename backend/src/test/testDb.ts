import { randomUUID } from "node:crypto";
import pg from "pg";
import { expect, vi } from "vitest";
import { EMBEDDING_DIMS } from "../constants.js";
import { createPool, type KnowledgeBaseRow } from "../db.js";
import { runMigrations } from "../migrate.js";

export const adminUrl = process.env.TEST_DATABASE_URL ?? "";

export function first<T>(rows: T[]): T {
  const [row] = rows;
  if (!row) throw new Error("expected at least one row");
  return row;
}

export function embedding(x: number, y = 0): number[] {
  const values = new Array<number>(EMBEDDING_DIMS).fill(0);
  values[0] = x;
  values[1] = y;
  return values;
}

export interface TestDb {
  url: string;
  pool: pg.Pool;
  drop: () => Promise<void>;
}

export async function createTestDb({ migrate = true } = {}): Promise<TestDb> {
  const name = `test_${randomUUID().replaceAll("-", "")}`;
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  url.searchParams.set("sslmode", "disable");
  let pool: pg.Pool | undefined;

  async function drop() {
    try {
      await pool?.end();
      await vi.waitFor(async () => {
        const { rows } = await admin.query(
          "select count(*)::int as n from pg_stat_activity where datname = $1",
          [name],
        );
        expect(rows[0].n).toBe(0);
      }, 10_000);
    } finally {
      await admin.query(`drop database if exists ${name} with (force)`).catch(() => undefined);
      await admin.end();
    }
  }

  try {
    await admin.query(`create database ${name}`);
    pool = createPool(url.toString());
    if (migrate) await runMigrations(pool);
    return { url: url.toString(), pool, drop };
  } catch (err) {
    await drop();
    throw err;
  }
}

export async function insertNote(
  pool: pg.Pool,
  text: string,
  status = "SUBMITTED",
): Promise<KnowledgeBaseRow> {
  const { rows } = await pool.query<KnowledgeBaseRow>(
    `insert into knowledge_base (type, raw_content, content_hash, status)
     values ('NOTE', $1, md5($1), $2) returning *`,
    [text, status],
  );
  return first(rows);
}

export async function softDelete(pool: pg.Pool, id: string): Promise<void> {
  await pool.query("update knowledge_base set deleted_at = now() where id = $1", [id]);
}

export async function insertChunk(
  pool: pg.Pool,
  itemId: string,
  index: number,
  vector: number[] | string,
): Promise<void> {
  await pool.query(
    "insert into chunks (item_id, chunk_index, content, embedding) values ($1, $2, $3, $4)",
    [itemId, index, `chunk ${index}`, typeof vector === "string" ? vector : JSON.stringify(vector)],
  );
}
