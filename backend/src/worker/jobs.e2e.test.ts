import type pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { URL_CONTENT_MAX_CHARS } from "../constants.js";
import type { ChunkRow, KnowledgeBaseRow } from "../db.js";
import { insertUrlItem } from "../itemQueries.js";
import { stubJina, type FakePage } from "../test/fakeJina.js";
import { adminUrl, createTestDb, first, insertNote, type TestDb } from "../test/testDb.js";
import { chunkText } from "./chunk.js";
import { createWorker } from "./jobs.js";

const longNote = Array.from({ length: 600 }, (_, i) => `word${i}`).join(" ");

describe.skipIf(!adminUrl)("ingestion worker", () => {
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
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function item(id: string): Promise<KnowledgeBaseRow> {
    const { rows } = await pool.query<KnowledgeBaseRow>(
      "select * from knowledge_base where id = $1",
      [id],
    );
    return first(rows);
  }

  async function chunks(id: string): Promise<ChunkRow[]> {
    const { rows } = await pool.query<ChunkRow>(
      "select * from chunks where item_id = $1 order by chunk_index",
      [id],
    );
    return rows;
  }

  async function runOnce(pages: Record<string, FakePage> = {}) {
    stubJina(pages);
    return createWorker(pool, "key").run();
  }

  it("turns a submitted note into READY with the right chunks", async () => {
    const note = await insertNote(pool, longNote);
    await runOnce();
    expect(await item(note.id)).toMatchObject({ status: "READY", error_message: null });
    const expected = await chunkText(longNote);
    const saved = await chunks(note.id);
    expect(saved.map((c) => c.content)).toEqual(expected);
    expect(saved.map((c) => c.chunk_index)).toEqual(expected.map((_, i) => i));
  });

  it("fills title and raw_content of a URL item from Jina Reader", async () => {
    const url = await insertUrlItem(pool, "https://example.com/post");
    await runOnce({ "https://example.com/post": { title: "A Post", content: "Body text" } });
    expect(await item(url.id)).toMatchObject({
      status: "READY",
      title: "A Post",
      raw_content: "Body text",
    });
    expect(await chunks(url.id)).toHaveLength(1);
  });

  it("cuts a very large page at 200k chars and still marks it READY", async () => {
    const url = await insertUrlItem(pool, "https://example.com/big");
    await runOnce({ "https://example.com/big": { content: "a ".repeat(URL_CONTENT_MAX_CHARS) } });
    const row = await item(url.id);
    expect(row.status).toBe("READY");
    expect(row.raw_content).toHaveLength(URL_CONTENT_MAX_CHARS);
  });

  it("retries an unreachable URL and marks it FAILED after 4 attempts", async () => {
    const url = await insertUrlItem(pool, "https://down.example.com");
    const pages = { "https://down.example.com": new TypeError("fetch failed") };
    for (let attempt = 1; attempt <= 3; attempt++) {
      await runOnce(pages);
      expect(await item(url.id)).toMatchObject({
        status: "SUBMITTED",
        retry_count: attempt,
        error_message: "fetch failed",
      });
    }
    await runOnce(pages);
    expect(await item(url.id)).toMatchObject({
      status: "FAILED",
      retry_count: 4,
      error_message: "fetch failed",
    });
    await runOnce(pages);
    expect((await item(url.id)).retry_count).toBe(4);
  });

  it("keeps processing other jobs when one fails", async () => {
    const bad = await insertUrlItem(pool, "https://bad.example.com");
    const empty = await insertUrlItem(pool, "https://empty.example.com");
    const note = await insertNote(pool, "good note");
    await runOnce({
      "https://bad.example.com": { status: 500 },
      "https://empty.example.com": { title: "t", content: "  " },
    });
    expect(await item(bad.id)).toMatchObject({
      status: "SUBMITTED",
      error_message: "Jina Reader failed with HTTP 500",
    });
    expect(await item(empty.id)).toMatchObject({
      status: "SUBMITTED",
      error_message: "No text content found",
    });
    expect((await item(note.id)).status).toBe("READY");
  });

  it("re-queues a job stuck in PROCESSING for over 10 min, but not a recent one", async () => {
    const stuck = await insertNote(pool, "stuck note");
    const recent = await insertNote(pool, "recent note");
    await pool.query("update knowledge_base set status = 'PROCESSING'");
    await pool.query("alter table knowledge_base disable trigger knowledge_base_set_modified_at");
    await pool.query(
      "update knowledge_base set modified_at = now() - interval '11 minutes' where id = $1",
      [stuck.id],
    );
    await pool.query("alter table knowledge_base enable trigger knowledge_base_set_modified_at");
    await runOnce();
    expect(await item(stuck.id)).toMatchObject({ status: "READY", retry_count: 1 });
    expect(await item(recent.id)).toMatchObject({ status: "PROCESSING", retry_count: 0 });
  });

  it("does not create duplicate chunks when an item is processed again", async () => {
    const note = await insertNote(pool, longNote);
    await runOnce();
    const before = await chunks(note.id);
    await pool.query("update knowledge_base set status = 'SUBMITTED' where id = $1", [note.id]);
    await runOnce();
    const after = await chunks(note.id);
    expect(after).toHaveLength(before.length);
    expect(after.map((c) => c.content)).toEqual(before.map((c) => c.content));
  });

  it("processes at most 3 jobs per run, oldest first", async () => {
    const notes = [];
    for (let i = 0; i < 4; i++) notes.push(await insertNote(pool, `note ${i}`));
    await runOnce();
    const statuses = await Promise.all(notes.map(async (n) => (await item(n.id)).status));
    expect(statuses).toEqual(["READY", "READY", "READY", "SUBMITTED"]);
  });

  it("never overlaps two runs of the same worker", async () => {
    await insertNote(pool, "note");
    stubJina();
    const worker = createWorker(pool, "key");
    const [a, b] = await Promise.all([worker.run(), worker.run()]);
    expect([a, b]).toEqual([true, false]);
    expect(await worker.run()).toBe(true);
  });

  it("waits for the current run in idle()", async () => {
    const note = await insertNote(pool, "note");
    stubJina();
    const worker = createWorker(pool, "key");
    const running = worker.run();
    await worker.idle();
    expect((await item(note.id)).status).toBe("READY");
    expect(await running).toBe(true);
  });

  it("does not overwrite a job that is no longer PROCESSING", async () => {
    const note = await insertNote(pool, "note");
    const fetchMock = stubJina();
    const answer = fetchMock.getMockImplementation() as typeof fetch;
    fetchMock.mockImplementationOnce(async (input, init) => {
      await pool.query("update knowledge_base set status = 'SUBMITTED' where id = $1", [note.id]);
      return answer(input, init);
    });
    await createWorker(pool, "key").run();
    expect(await item(note.id)).toMatchObject({ status: "SUBMITTED", retry_count: 0 });
    expect(await chunks(note.id)).toEqual([]);
  });

  it("logs one structured line per job", async () => {
    const note = await insertNote(pool, "note");
    await runOnce();
    const line = JSON.parse(String(vi.mocked(console.log).mock.calls[0]?.[0]));
    expect(line).toMatchObject({ id: note.id, type: "NOTE", result: "READY", chunks: 1 });
    expect(typeof line.durationMs).toBe("number");
  });
});
