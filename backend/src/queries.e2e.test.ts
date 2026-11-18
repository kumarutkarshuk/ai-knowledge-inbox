import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { withTransaction } from "./db.js";
import { claimJobs, matchChunks, resetStuckJobs } from "./queries.js";
import {
  adminUrl,
  createTestDb,
  embedding,
  first,
  insertChunk,
  insertNote,
  softDelete,
  type TestDb,
} from "./test/testDb.js";

describe.skipIf(!adminUrl)("queries", () => {
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

  describe("claimJobs", () => {
    it("claims the oldest SUBMITTED, non-deleted rows and marks them PROCESSING", async () => {
      const one = await insertNote(pool, "1");
      const two = await insertNote(pool, "2");
      const three = await insertNote(pool, "3");
      await insertNote(pool, "ready", "READY");
      await insertNote(pool, "failed", "FAILED");
      const deleted = await insertNote(pool, "deleted");
      await softDelete(pool, deleted.id);

      const claimed = await claimJobs(pool, 2);
      expect(claimed.map((r) => r.id).sort()).toEqual([one.id, two.id].sort());
      expect(claimed.every((r) => r.status === "PROCESSING")).toBe(true);

      expect((await claimJobs(pool, 5)).map((r) => r.id)).toEqual([three.id]);
      expect(await claimJobs(pool, 5)).toEqual([]);
    });

    it("never gives the same row to two sessions with open transactions", async () => {
      for (let i = 0; i < 6; i++) await insertNote(pool, `job ${i}`);
      const a = await pool.connect();
      const b = await pool.connect();
      try {
        await a.query("begin");
        await b.query("begin");
        const fromA = await claimJobs(a, 3);
        const fromB = await claimJobs(b, 3);
        await a.query("commit");
        await b.query("commit");
        expect(fromA).toHaveLength(3);
        expect(fromB).toHaveLength(3);
        expect(new Set([...fromA, ...fromB].map((r) => r.id)).size).toBe(6);
      } finally {
        a.release();
        b.release();
      }
    });

    it("returns claimed rows oldest first", async () => {
      const ids = [];
      for (let i = 0; i < 5; i++) ids.push((await insertNote(pool, `job ${i}`)).id);
      expect((await claimJobs(pool, 5)).map((r) => r.id)).toEqual(ids);
    });

    it("rejects a bad batch size", async () => {
      await expect(claimJobs(pool, -1)).rejects.toThrow(/non-negative integer/);
      await expect(claimJobs(pool, 1.5)).rejects.toThrow(/non-negative integer/);
    });

    it("never gives the same row twice under many parallel calls", async () => {
      for (let i = 0; i < 40; i++) await insertNote(pool, `job ${i}`);
      const results = await Promise.all(Array.from({ length: 10 }, () => claimJobs(pool, 3)));
      const ids = results.flat().map((r) => r.id);
      expect(ids).toHaveLength(30);
      expect(new Set(ids).size).toBe(30);
    });
  });

  describe("withTransaction", () => {
    it("rolls back on error and returns the client to the pool", async () => {
      await expect(
        withTransaction(pool, async (client) => {
          await client.query(
            "insert into knowledge_base (type, content_hash) values ('NOTE', 'tx')",
          );
          throw new Error("boom");
        }),
      ).rejects.toThrow("boom");
      const { rows } = await pool.query("select count(*)::int as n from knowledge_base");
      expect(rows[0].n).toBe(0);
      expect(pool.totalCount).toBe(pool.idleCount);
    });

    it("commits on success", async () => {
      const claimed = await withTransaction(pool, async (client) => {
        await insertNote(pool, "job");
        return claimJobs(client, 1);
      });
      expect(claimed).toHaveLength(1);
      const { rows } = await pool.query("select status from knowledge_base");
      expect(rows).toEqual([{ status: "PROCESSING" }]);
    });
  });

  describe("resetStuckJobs", () => {
    it("re-queues a stuck job and counts it as a retry", async () => {
      const row = await insertNote(pool, "stuck");
      await claimJobs(pool, 1);
      const reset = await resetStuckJobs(pool, 0, 3);
      expect(reset).toHaveLength(1);
      expect(reset[0]).toMatchObject({ id: row.id, status: "SUBMITTED", retry_count: 1 });
    });

    it("fails a stuck job that has no retries left", async () => {
      const row = await insertNote(pool, "stuck");
      await pool.query("update knowledge_base set retry_count = 3 where id = $1", [row.id]);
      await claimJobs(pool, 1);
      expect((await resetStuckJobs(pool, 0, 3))[0]).toMatchObject({
        status: "FAILED",
        retry_count: 4,
        error_message: "Processing timed out",
      });
    });

    it("keeps the last allowed retry as SUBMITTED", async () => {
      const row = await insertNote(pool, "stuck");
      await pool.query("update knowledge_base set retry_count = 2 where id = $1", [row.id]);
      await claimJobs(pool, 1);
      expect((await resetStuckJobs(pool, 0, 3))[0]).toMatchObject({
        status: "SUBMITTED",
        retry_count: 3,
      });
    });

    it("leaves recent PROCESSING rows and other statuses alone", async () => {
      await insertNote(pool, "processing");
      await claimJobs(pool, 1);
      await insertNote(pool, "submitted");
      await insertNote(pool, "ready", "READY");
      expect(await resetStuckJobs(pool, 10, 3)).toEqual([]);
      expect(await resetStuckJobs(pool, 0, 3)).toHaveLength(1);
    });
  });

  describe("matchChunks", () => {
    it("returns READY, non-deleted chunks above the threshold, best first", async () => {
      const ready = await insertNote(pool, "ready", "READY");
      await pool.query("update knowledge_base set title = 'Ready note' where id = $1", [ready.id]);
      const url = first(
        (
          await pool.query<{ id: string }>(
            `insert into knowledge_base (type, source_url, title, status)
             values ('URL', 'https://example.com', 'Page', 'READY') returning id`,
          )
        ).rows,
      );
      const deleted = await insertNote(pool, "deleted", "READY");
      await softDelete(pool, deleted.id);
      const failed = await insertNote(pool, "failed", "FAILED");
      const processing = await insertNote(pool, "processing", "PROCESSING");

      await insertChunk(pool, ready.id, 0, embedding(1, 0));
      await insertChunk(pool, ready.id, 1, embedding(1, 1));
      await insertChunk(pool, ready.id, 2, embedding(0, 1));
      await insertChunk(pool, url.id, 0, embedding(1, 0.2));
      await insertChunk(pool, deleted.id, 0, embedding(1, 0));
      await insertChunk(pool, failed.id, 0, embedding(1, 0));
      await insertChunk(pool, processing.id, 0, embedding(1, 0));

      const rows = await matchChunks(pool, embedding(1, 0), 5, 0.5);

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

    it("still fills matchCount through the HNSW index when closer chunks are filtered out", async () => {
      const deleted = await insertNote(pool, "deleted", "READY");
      await softDelete(pool, deleted.id);
      const ready = await insertNote(pool, "ready", "READY");
      for (let i = 0; i < 200; i++) await insertChunk(pool, deleted.id, i, embedding(1, i * 0.001));
      for (let i = 0; i < 5; i++)
        await insertChunk(pool, ready.id, i, embedding(1, 0.5 + i * 0.01));
      const indexOnly = new pg.Pool({
        connectionString: db.url,
        options: "-c enable_seqscan=off -c enable_sort=off",
      });
      try {
        const rows = await matchChunks(indexOnly, embedding(1), 5, 0.5);
        expect(rows.map((r) => r.item_id)).toEqual(Array(5).fill(ready.id));
      } finally {
        await indexOnly.end();
      }
    });

    it("respects matchCount", async () => {
      const ready = await insertNote(pool, "ready", "READY");
      for (let i = 0; i < 4; i++) await insertChunk(pool, ready.id, i, embedding(1, i * 0.1));
      expect(await matchChunks(pool, embedding(1), 2, 0)).toHaveLength(2);
    });

    it("returns nothing when no chunk reaches the threshold", async () => {
      const ready = await insertNote(pool, "ready", "READY");
      await insertChunk(pool, ready.id, 0, embedding(0, 1));
      expect(await matchChunks(pool, embedding(1), 5, 0.5)).toEqual([]);
    });

    it("rejects bad input and leaves the pool usable", async () => {
      const ready = await insertNote(pool, "ready", "READY");
      await insertChunk(pool, ready.id, 0, embedding(1));
      await expect(matchChunks(pool, [1, 2, 3], 5, 0.5)).rejects.toThrow(/1024 finite numbers/);
      const nan = embedding(1);
      nan[5] = Number.NaN;
      await expect(matchChunks(pool, nan, 5, 0.5)).rejects.toThrow(/finite/);
      await expect(matchChunks(pool, embedding(1), -1, 0.5)).rejects.toThrow(/non-negative/);
      expect(await matchChunks(pool, embedding(1), 5, 0.5)).toHaveLength(1);
      expect(pool.totalCount).toBe(pool.idleCount);
    });
  });
});
