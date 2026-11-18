import type pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  adminUrl,
  createTestDb,
  embedding,
  insertChunk,
  insertNote,
  softDelete,
  type TestDb,
} from "./test/testDb.js";

describe.skipIf(!adminUrl)("database schema", () => {
  let db: TestDb;
  let pool: pg.Pool;

  beforeAll(async () => {
    db = await createTestDb();
    pool = db.pool;
  });

  afterAll(async () => {
    await db?.drop();
  });

  beforeEach(async () => {
    await pool.query("truncate knowledge_base cascade");
  });

  describe("knowledge_base", () => {
    it("fills defaults on insert", async () => {
      const row = await insertNote(pool, "hello");
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
      await expect(insertNote(pool, "x", "DONE")).rejects.toThrow(/check constraint/);
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
      const row = await insertNote(pool, "same");
      await softDelete(pool, row.id);
      await expect(insertNote(pool, "same")).rejects.toThrow(/duplicate key/);
    });

    it("allows many URL rows (null content_hash) and many NOTE rows (null source_url)", async () => {
      await pool.query(
        `insert into knowledge_base (type, source_url) values ('URL', 'https://a.com'), ('URL', 'https://b.com')`,
      );
      await insertNote(pool, "one");
      await insertNote(pool, "two");
      const { rows } = await pool.query("select count(*)::int as n from knowledge_base");
      expect(rows[0].n).toBe(4);
    });

    it("updates modified_at on every update", async () => {
      const row = await insertNote(pool, "hello");
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
      const row = await insertNote(pool, "hello");
      await insertChunk(pool, row.id, 0, embedding(1));
      await pool.query("delete from knowledge_base where id = $1", [row.id]);
      const { rows } = await pool.query("select count(*)::int as n from chunks");
      expect(rows[0].n).toBe(0);
    });

    it("reject an embedding with the wrong size", async () => {
      const row = await insertNote(pool, "hello");
      await expect(insertChunk(pool, row.id, 0, "[1,2,3]")).rejects.toThrow(
        /expected 1024 dimensions/,
      );
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
});
