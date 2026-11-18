import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createPool, type KnowledgeBaseRow, type MatchChunkRow } from "./db.js";

const adminUrl = process.env.TEST_DATABASE_URL ?? "";
const migrationsDir = path.resolve(import.meta.dirname, "..", "..", "supabase", "migrations");
const dbName = `test_${randomUUID().replaceAll("-", "")}`;

function first<T>(rows: T[]): T {
  const [row] = rows;
  if (!row) throw new Error("expected at least one row");
  return row;
}

function vector(x: number, y = 0) {
  const values = new Array<number>(1024).fill(0);
  values[0] = x;
  values[1] = y;
  return `[${values.join(",")}]`;
}

describe.skipIf(!adminUrl)("database migration", () => {
  let admin: pg.Client;
  let pool: pg.Pool;

  async function insertNote(text: string, status = "SUBMITTED") {
    const { rows } = await pool.query<KnowledgeBaseRow>(
      `insert into knowledge_base (type, raw_content, content_hash, status)
       values ('NOTE', $1, md5($1), $2) returning *`,
      [text, status],
    );
    return first(rows);
  }

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect();
    await admin.query(`create database ${dbName}`);
    const url = new URL(adminUrl);
    url.pathname = `/${dbName}`;
    pool = createPool(url.toString(), false);
    const files = readdirSync(migrationsDir)
      .filter((file) => file.endsWith(".sql"))
      .sort();
    for (const file of files) {
      await pool.query(readFileSync(path.join(migrationsDir, file), "utf8"));
    }
  });

  afterAll(async () => {
    await pool?.end();
    if (!admin) return;
    await vi.waitFor(async () => {
      const { rows } = await admin.query(
        "select count(*)::int as n from pg_stat_activity where datname = $1",
        [dbName],
      );
      expect(rows[0].n).toBe(0);
    }, 10_000);
    await admin.query(`drop database if exists ${dbName}`);
    await admin.end();
  });

  beforeEach(async () => {
    await pool.query("truncate knowledge_base cascade");
  });

  describe("knowledge_base", () => {
    it("fills defaults on insert", async () => {
      const row = await insertNote("hello");
      expect(row.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(row.status).toBe("SUBMITTED");
      expect(row.retry_count).toBe(0);
      expect(row.deleted_at).toBeNull();
      expect(row.created_at).toBeInstanceOf(Date);
      expect(row.modified_at).toBeInstanceOf(Date);
    });

    it("rejects a URL row without source_url", async () => {
      await expect(pool.query("insert into knowledge_base (type) values ('URL')")).rejects.toThrow(
        /check constraint/,
      );
    });

    it("rejects a NOTE row without content_hash", async () => {
      await expect(
        pool.query("insert into knowledge_base (type, raw_content) values ('NOTE', 'x')"),
      ).rejects.toThrow(/check constraint/);
    });

    it("rejects an unknown type or status", async () => {
      await expect(
        pool.query(
          "insert into knowledge_base (type, source_url, content_hash) values ('PDF', 'a', 'b')",
        ),
      ).rejects.toThrow(/check constraint/);
      await expect(insertNote("x", "DONE")).rejects.toThrow(/check constraint/);
    });

    it("rejects a duplicate source_url even when the first row is deleted", async () => {
      await pool.query(
        `insert into knowledge_base (type, source_url, deleted_at)
         values ('URL', 'https://example.com', now())`,
      );
      await expect(
        pool.query(
          "insert into knowledge_base (type, source_url) values ('URL', 'https://example.com')",
        ),
      ).rejects.toThrow(/duplicate key/);
    });

    it("rejects a duplicate content_hash even when the first row is deleted", async () => {
      const row = await insertNote("same");
      await pool.query("update knowledge_base set deleted_at = now() where id = $1", [row.id]);
      await expect(insertNote("same")).rejects.toThrow(/duplicate key/);
    });

    it("allows many URL rows (null content_hash) and many NOTE rows (null source_url)", async () => {
      await pool.query(
        `insert into knowledge_base (type, source_url) values ('URL', 'https://a.com'), ('URL', 'https://b.com')`,
      );
      await insertNote("one");
      await insertNote("two");
      const { rows } = await pool.query("select count(*)::int as n from knowledge_base");
      expect(rows[0].n).toBe(4);
    });

    it("updates modified_at on every update", async () => {
      const row = await insertNote("hello");
      const { rows } = await pool.query(
        "update knowledge_base set title = 't' where id = $1 returning modified_at > created_at as changed",
        [row.id],
      );
      expect(rows[0].changed).toBe(true);
    });

    it("has an index on (status, created_at)", async () => {
      const { rows } = await pool.query(
        "select indexdef from pg_indexes where tablename = 'knowledge_base' and indexdef like '%(status, created_at)%'",
      );
      expect(rows).toHaveLength(1);
    });
  });

  describe("chunks", () => {
    it("are removed when their item is hard deleted", async () => {
      const row = await insertNote("hello");
      await pool.query(
        "insert into chunks (item_id, chunk_index, content, embedding) values ($1, 0, 'c', $2)",
        [row.id, vector(1)],
      );
      await pool.query("delete from knowledge_base where id = $1", [row.id]);
      const { rows } = await pool.query("select count(*)::int as n from chunks");
      expect(rows[0].n).toBe(0);
    }, 10_000);

    it("reject an embedding with the wrong size", async () => {
      const row = await insertNote("hello");
      await expect(
        pool.query(
          "insert into chunks (item_id, chunk_index, content, embedding) values ($1, 0, 'c', '[1,2,3]')",
          [row.id],
        ),
      ).rejects.toThrow(/expected 1024 dimensions/);
    });

    it("have an HNSW cosine index on embedding", async () => {
      const { rows } = await pool.query(
        "select indexdef from pg_indexes where tablename = 'chunks' and indexdef like '%hnsw%vector_cosine_ops%'",
      );
      expect(rows).toHaveLength(1);
    });
  });

  describe("row level security", () => {
    it("is enabled with no policies on both tables", async () => {
      const { rows } = await pool.query(
        `select c.relname, c.relrowsecurity,
                (select count(*)::int from pg_policies p where p.tablename = c.relname) as policies
         from pg_class c where c.relname in ('knowledge_base', 'chunks') order by c.relname`,
      );
      expect(rows).toEqual([
        { relname: "chunks", relrowsecurity: true, policies: 0 },
        { relname: "knowledge_base", relrowsecurity: true, policies: 0 },
      ]);
    });
  });

  describe("privileges", () => {
    it("does not let other roles run the job functions", async () => {
      const role = `${dbName}_reader`;
      await pool.query(`create role ${role}`);
      try {
        const { rows } = await pool.query(
          `select has_function_privilege($1, 'claim_jobs(int)', 'execute') as claim,
                  has_function_privilege($1, 'reset_stuck_jobs(int, int)', 'execute') as reset,
                  has_function_privilege($1, 'match_chunks(vector, int, float)', 'execute') as match`,
          [role],
        );
        expect(rows[0]).toEqual({ claim: false, reset: false, match: false });
      } finally {
        await pool.query(`drop role ${role}`);
      }
    });
  });

  describe("claim_jobs", () => {
    it("claims the oldest SUBMITTED, non-deleted rows and marks them PROCESSING", async () => {
      const first = await insertNote("1");
      const second = await insertNote("2");
      const third = await insertNote("3");
      await insertNote("ready", "READY");
      await insertNote("failed", "FAILED");
      const deleted = await insertNote("deleted");
      await pool.query("update knowledge_base set deleted_at = now() where id = $1", [deleted.id]);

      const { rows } = await pool.query<KnowledgeBaseRow>("select * from claim_jobs($1)", [2]);
      expect(rows.map((r) => r.id).sort()).toEqual([first.id, second.id].sort());
      expect(rows.every((r) => r.status === "PROCESSING")).toBe(true);

      const next = await pool.query<KnowledgeBaseRow>("select * from claim_jobs($1)", [5]);
      expect(next.rows.map((r) => r.id)).toEqual([third.id]);

      const empty = await pool.query("select * from claim_jobs($1)", [5]);
      expect(empty.rows).toEqual([]);
    });

    it("never gives the same row to two sessions with open transactions", async () => {
      for (let i = 0; i < 6; i++) await insertNote(`job ${i}`);
      const a = await pool.connect();
      const b = await pool.connect();
      try {
        await a.query("begin");
        await b.query("begin");
        const fromA = await a.query<KnowledgeBaseRow>("select * from claim_jobs(3)");
        const fromB = await b.query<KnowledgeBaseRow>("select * from claim_jobs(3)");
        await a.query("commit");
        await b.query("commit");
        const ids = [...fromA.rows, ...fromB.rows].map((r) => r.id);
        expect(fromA.rows).toHaveLength(3);
        expect(fromB.rows).toHaveLength(3);
        expect(new Set(ids).size).toBe(6);
      } finally {
        a.release();
        b.release();
      }
    });

    it("never gives the same row twice under many parallel calls", async () => {
      for (let i = 0; i < 40; i++) await insertNote(`job ${i}`);
      const results = await Promise.all(
        Array.from({ length: 10 }, () =>
          pool.query<KnowledgeBaseRow>("select * from claim_jobs(3)"),
        ),
      );
      const ids = results.flatMap((r) => r.rows.map((row) => row.id));
      expect(ids).toHaveLength(30);
      expect(new Set(ids).size).toBe(30);
    });
  });

  describe("reset_stuck_jobs", () => {
    it("re-queues a stuck job and counts it as a retry", async () => {
      const row = await insertNote("stuck");
      await pool.query("select * from claim_jobs(1)");
      const { rows } = await pool.query<KnowledgeBaseRow>(
        "select * from reset_stuck_jobs($1, $2)",
        [0, 3],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ id: row.id, status: "SUBMITTED", retry_count: 1 });
    });

    it("fails a stuck job that has no retries left", async () => {
      const row = await insertNote("stuck");
      await pool.query("update knowledge_base set retry_count = 3 where id = $1", [row.id]);
      await pool.query("select * from claim_jobs(1)");
      const { rows } = await pool.query<KnowledgeBaseRow>("select * from reset_stuck_jobs(0, 3)");
      expect(rows[0]).toMatchObject({
        status: "FAILED",
        retry_count: 4,
        error_message: "Processing timed out",
      });
    });

    it("keeps the last allowed retry as SUBMITTED", async () => {
      const row = await insertNote("stuck");
      await pool.query("update knowledge_base set retry_count = 2 where id = $1", [row.id]);
      await pool.query("select * from claim_jobs(1)");
      const { rows } = await pool.query<KnowledgeBaseRow>("select * from reset_stuck_jobs(0, 3)");
      expect(rows[0]).toMatchObject({ status: "SUBMITTED", retry_count: 3 });
    });

    it("leaves recent PROCESSING rows and other statuses alone", async () => {
      await insertNote("processing");
      await pool.query("select * from claim_jobs(1)");
      await insertNote("submitted");
      await insertNote("ready", "READY");
      const { rows } = await pool.query("select * from reset_stuck_jobs(10, 3)");
      expect(rows).toEqual([]);
      const old = await pool.query("select * from reset_stuck_jobs(0, 3)");
      expect(old.rows).toHaveLength(1);
    });
  });

  describe("match_chunks", () => {
    async function addChunk(itemId: string, index: number, embedding: string) {
      await pool.query(
        "insert into chunks (item_id, chunk_index, content, embedding) values ($1, $2, $3, $4)",
        [itemId, index, `chunk ${index}`, embedding],
      );
    }

    it("returns READY, non-deleted chunks above the threshold, best first", async () => {
      const ready = await insertNote("ready", "READY");
      await pool.query("update knowledge_base set title = 'Ready note' where id = $1", [ready.id]);
      const url = first(
        (
          await pool.query<KnowledgeBaseRow>(
            `insert into knowledge_base (type, source_url, title, status)
             values ('URL', 'https://example.com', 'Page', 'READY') returning *`,
          )
        ).rows,
      );
      const deleted = await insertNote("deleted", "READY");
      await pool.query("update knowledge_base set deleted_at = now() where id = $1", [deleted.id]);
      const failed = await insertNote("failed", "FAILED");
      const processing = await insertNote("processing", "PROCESSING");

      await addChunk(ready.id, 0, vector(1, 0));
      await addChunk(ready.id, 1, vector(1, 1));
      await addChunk(ready.id, 2, vector(0, 1));
      await addChunk(url.id, 0, vector(1, 0.2));
      await addChunk(deleted.id, 0, vector(1, 0));
      await addChunk(failed.id, 0, vector(1, 0));
      await addChunk(processing.id, 0, vector(1, 0));

      const { rows } = await pool.query<MatchChunkRow>("select * from match_chunks($1, $2, $3)", [
        vector(1, 0),
        5,
        0.5,
      ]);

      expect(rows.map((r) => [r.item_id, r.content])).toEqual([
        [ready.id, "chunk 0"],
        [url.id, "chunk 0"],
        [ready.id, "chunk 1"],
      ]);
      const [best, second, third] = rows;
      expect(best).toMatchObject({ type: "NOTE", title: "Ready note", source_url: null });
      expect(best?.similarity).toBeCloseTo(1);
      expect(second).toMatchObject({
        type: "URL",
        title: "Page",
        source_url: "https://example.com",
      });
      expect(third?.similarity).toBeCloseTo(Math.SQRT1_2);
      expect(Object.keys(best ?? {}).sort()).toEqual(
        ["content", "id", "item_id", "similarity", "source_url", "title", "type"].sort(),
      );
    });

    it("still fills match_count through the HNSW index when closer chunks are filtered out", async () => {
      const deleted = await insertNote("deleted", "READY");
      await pool.query("update knowledge_base set deleted_at = now() where id = $1", [deleted.id]);
      const ready = await insertNote("ready", "READY");
      for (let i = 0; i < 200; i++) await addChunk(deleted.id, i, vector(1, i * 0.001));
      for (let i = 0; i < 5; i++) await addChunk(ready.id, i, vector(1, 0.5 + i * 0.01));
      const client = await pool.connect();
      try {
        await client.query("set enable_seqscan = off; set enable_sort = off");
        const { rows } = await client.query<MatchChunkRow>(
          "select * from match_chunks($1, 5, 0.5)",
          [vector(1)],
        );
        expect(rows.map((r) => r.item_id)).toEqual(Array(5).fill(ready.id));
      } finally {
        await client.query("reset enable_seqscan; reset enable_sort");
        client.release();
      }
    });

    it("respects match_count", async () => {
      const ready = await insertNote("ready", "READY");
      for (let i = 0; i < 4; i++) await addChunk(ready.id, i, vector(1, i * 0.1));
      const { rows } = await pool.query("select * from match_chunks($1, 2, 0)", [vector(1)]);
      expect(rows).toHaveLength(2);
    });

    it("returns nothing when no chunk reaches the threshold", async () => {
      const ready = await insertNote("ready", "READY");
      await addChunk(ready.id, 0, vector(0, 1));
      const { rows } = await pool.query("select * from match_chunks($1, 5, 0.5)", [vector(1)]);
      expect(rows).toEqual([]);
    });
  });
});
