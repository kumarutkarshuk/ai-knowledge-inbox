import { randomUUID } from "node:crypto";
import type pg from "pg";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { signToken } from "../auth.js";
import type { KnowledgeBaseRow } from "../db.js";
import { hashNote } from "../ingest.js";
import { validEnv } from "../test/fixtures.js";
import { adminUrl, createTestDb, first, type TestDb } from "../test/testDb.js";
import type { Item } from "../types/api.js";

const auth = `Bearer ${signToken(validEnv.TOKEN_SECRET).token}`;

describe.skipIf(!adminUrl)("items API", () => {
  let db: TestDb;
  let pool: pg.Pool;
  let app: ReturnType<typeof createApp>;

  beforeAll(async () => {
    db = await createTestDb();
    pool = db.pool;
    app = createApp(validEnv, pool);
  });

  afterAll(async () => {
    await db?.drop();
  });

  beforeEach(async () => {
    await pool.query("truncate knowledge_base cascade");
  });

  function ingest(body: unknown) {
    return request(app)
      .post("/ingest")
      .set("Authorization", auth)
      .send(body as object);
  }

  function list() {
    return request(app).get("/items").set("Authorization", auth);
  }

  function remove(id: string) {
    return request(app).delete(`/items/${id}`).set("Authorization", auth);
  }

  async function row(id: string): Promise<KnowledgeBaseRow> {
    const { rows } = await pool.query<KnowledgeBaseRow>(
      "select * from knowledge_base where id = $1",
      [id],
    );
    return first(rows);
  }

  async function setRow(id: string, values: Record<string, unknown>) {
    const keys = Object.keys(values);
    const set = keys.map((key, i) => `${key} = $${i + 2}`).join(", ");
    await pool.query(`update knowledge_base set ${set} where id = $1`, [
      id,
      ...Object.values(values),
    ]);
  }

  async function addNote(content: string, title?: string): Promise<Item> {
    const res = await ingest({ type: "NOTE", content, title });
    expect(res.status).toBe(201);
    return res.body.item as Item;
  }

  describe("auth", () => {
    it.each([
      ["post", "/ingest"],
      ["get", "/items"],
      ["delete", `/items/${randomUUID()}`],
    ] as const)("%s %s needs a token", async (method, path) => {
      const res = await request(app)[method](path).set("Authorization", "Bearer tampered");
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("UNAUTHORIZED");
    });
  });

  describe("POST /ingest NOTE", () => {
    it("saves a trimmed note as SUBMITTED with a sha256 hash", async () => {
      const item = await addNote("  hello world  \n", "  My note ");
      expect(item).toMatchObject({
        type: "NOTE",
        title: "My note",
        sourceUrl: null,
        preview: "hello world",
        status: "SUBMITTED",
        errorMessage: null,
      });
      expect(new Date(item.createdAt).toISOString()).toBe(item.createdAt);
      const saved = await row(item.id);
      expect(saved.raw_content).toBe("hello world");
      expect(saved.content_hash).toBe(hashNote("hello world"));
      expect(saved.retry_count).toBe(0);
    });

    it("uses the first 60 chars of the trimmed content as the title", async () => {
      const content = `${"x".repeat(70)}`;
      expect((await addNote(`  ${content}`)).title).toBe("x".repeat(60));
      expect((await addNote("other note", "   ")).title).toBe("other note");
    });

    it("returns 409 for the same note with extra whitespace", async () => {
      await addNote("same note");
      const res = await ingest({ type: "NOTE", content: "\n  same note \t" });
      expect(res.status).toBe(409);
      expect(res.body).toEqual({ error: { code: "ALREADY_EXISTS", message: "Already saved" } });
    });

    it("accepts a note of exactly 50,000 chars", async () => {
      const res = await ingest({ type: "NOTE", content: "a".repeat(50_000) });
      expect(res.status).toBe(201);
      expect(res.body.item.preview).toBe("a".repeat(200));
    });

    it.each([
      ["a 50,001-char note", { type: "NOTE", content: "a".repeat(50_001) }],
      ["an empty note", { type: "NOTE", content: "   " }],
      ["a missing content", { type: "NOTE" }],
      ["a non-string content", { type: "NOTE", content: 5 }],
      ["a 201-char title", { type: "NOTE", content: "x", title: "t".repeat(201) }],
      ["an unknown type", { type: "PDF", content: "x" }],
      ["an empty body", {}],
    ])("returns 400 for %s", async (_name, body) => {
      const res = await ingest(body);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
      expect(await list().then((r) => r.body.items)).toEqual([]);
    });
  });

  describe("POST /ingest URL", () => {
    it("saves the normalized URL as SUBMITTED", async () => {
      const res = await ingest({ type: "URL", url: " HTTPS://Example.com/Blog/Post/#intro " });
      expect(res.status).toBe(201);
      expect(res.body.item).toMatchObject({
        type: "URL",
        title: "https://example.com/Blog/Post",
        sourceUrl: "https://example.com/Blog/Post",
        preview: null,
        status: "SUBMITTED",
      });
    });

    it("treats a different fragment or trailing slash as the same item", async () => {
      expect((await ingest({ type: "URL", url: "https://Example.com/a/#x" })).status).toBe(201);
      const res = await ingest({ type: "URL", url: "https://example.com/a" });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("ALREADY_EXISTS");
    });

    it("accepts a URL of 2048 chars", async () => {
      const url = `https://example.com/${"a".repeat(2048 - 20)}`;
      expect(url).toHaveLength(2048);
      expect((await ingest({ type: "URL", url })).status).toBe(201);
    });

    it("accepts localhost and IP hosts", async () => {
      expect((await ingest({ type: "URL", url: "http://localhost:8080/a" })).status).toBe(201);
      expect((await ingest({ type: "URL", url: "http://10.0.0.1/a" })).status).toBe(201);
    });

    it("keeps a different query string as a different item", async () => {
      expect((await ingest({ type: "URL", url: "https://example.com/a?p=1" })).status).toBe(201);
      expect((await ingest({ type: "URL", url: "https://example.com/a?p=2" })).status).toBe(201);
    });

    it.each([
      "ftp://example.com/file",
      "not a url",
      "javascript:alert(1)",
      "",
      `https://example.com/${"a".repeat(2048)}`,
    ])("returns 400 for %j", async (url) => {
      const res = await ingest({ type: "URL", url });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    });
  });

  describe("POST /ingest race", () => {
    it("gives 201 once and 409 to the rest for the same note sent at once", async () => {
      const results = await Promise.all(
        Array.from({ length: 6 }, () => ingest({ type: "NOTE", content: "race note" })),
      );
      const statuses = results.map((r) => r.status).sort();
      expect(statuses).toEqual([201, 409, 409, 409, 409, 409]);
    });

    it("gives 200 once and 409 to the rest when restoring at once", async () => {
      const item = await addNote("restore race");
      await setRow(item.id, { status: "READY", deleted_at: new Date() });
      const results = await Promise.all(
        Array.from({ length: 4 }, () => ingest({ type: "NOTE", content: "restore race" })),
      );
      expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409, 409]);
    });
  });

  describe("restore", () => {
    it("brings back a deleted READY item unchanged with 200", async () => {
      const item = await addNote("ready note", "Old title");
      await setRow(item.id, { status: "READY" });
      expect((await remove(item.id)).status).toBe(204);
      const before = await row(item.id);

      const res = await ingest({ type: "NOTE", content: "ready note", title: "New title" });
      expect(res.status).toBe(200);
      expect(res.body.item).toMatchObject({ id: item.id, status: "READY", title: "Old title" });
      const after = await row(item.id);
      expect(after.deleted_at).toBeNull();
      expect(after.retry_count).toBe(before.retry_count);
      expect((await list()).body.items.map((i: Item) => i.id)).toEqual([item.id]);
    });

    it("re-queues a deleted FAILED item with retry_count 0", async () => {
      const res1 = await ingest({ type: "URL", url: "https://example.com/fail" });
      const id = res1.body.item.id as string;
      await setRow(id, {
        status: "FAILED",
        retry_count: 4,
        error_message: "No text content found",
      });
      expect((await remove(id)).status).toBe(204);

      const res = await ingest({ type: "URL", url: "https://EXAMPLE.com/fail/" });
      expect(res.status).toBe(200);
      expect(res.body.item).toMatchObject({ id, status: "SUBMITTED", errorMessage: null });
      const after = await row(id);
      expect(after.retry_count).toBe(0);
      expect(after.error_message).toBeNull();
      expect(after.deleted_at).toBeNull();
    });
  });

  describe("GET /items", () => {
    it("returns non-deleted items newest first", async () => {
      const a = await addNote("first");
      const b = await addNote("second");
      const c = await addNote("third");
      await setRow(a.id, { created_at: "2026-01-01T00:00:00Z" });
      await setRow(c.id, { created_at: "2026-01-02T00:00:00Z", status: "READY" });
      await remove(c.id);

      const res = await list();
      expect(res.status).toBe(200);
      expect(res.body.items.map((i: Item) => i.id)).toEqual([b.id, a.id]);
      expect(res.body.items[1].createdAt).toBe("2026-01-01T00:00:00.000Z");
    });

    it("maps a processed URL to its page title and a FAILED error message", async () => {
      const res1 = await ingest({ type: "URL", url: "https://example.com/page" });
      const id = res1.body.item.id as string;
      await setRow(id, {
        title: "Page title",
        raw_content: "page text",
        status: "FAILED",
        error_message: "Timed out",
      });
      const [item] = (await list()).body.items as Item[];
      expect(item).toEqual({
        id,
        type: "URL",
        title: "Page title",
        sourceUrl: "https://example.com/page",
        preview: null,
        status: "FAILED",
        errorMessage: "Timed out",
        createdAt: expect.any(String),
      });
    });

    it("returns an empty list", async () => {
      expect((await list()).body).toEqual({ items: [] });
    });
  });

  describe("DELETE /items/:id", () => {
    it.each(["READY", "FAILED"])("soft deletes a %s item with 204", async (status) => {
      const item = await addNote(`delete ${status}`);
      await setRow(item.id, { status });
      const res = await remove(item.id);
      expect(res.status).toBe(204);
      expect(res.text).toBe("");
      expect((await row(item.id)).deleted_at).not.toBeNull();
      expect((await list()).body.items).toEqual([]);
    });

    it("keeps the chunks of a deleted item", async () => {
      const item = await addNote("chunked");
      await setRow(item.id, { status: "READY" });
      await pool.query(
        "insert into chunks (item_id, chunk_index, content, embedding) values ($1, 0, 'c', $2)",
        [item.id, JSON.stringify(new Array(1024).fill(0.1))],
      );
      await remove(item.id);
      const { rows } = await pool.query("select count(*)::int as n from chunks");
      expect(rows[0].n).toBe(1);
    });

    it.each(["SUBMITTED", "PROCESSING"])("returns 409 ITEM_BUSY for a %s item", async (status) => {
      const item = await addNote(`busy ${status}`);
      await setRow(item.id, { status });
      const res = await remove(item.id);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("ITEM_BUSY");
      expect((await row(item.id)).deleted_at).toBeNull();
    });

    it("returns 404 for a missing, deleted or invalid id", async () => {
      const item = await addNote("gone");
      await setRow(item.id, { status: "READY" });
      expect((await remove(item.id)).status).toBe(204);
      expect((await remove(item.id)).status).toBe(404);
      expect((await remove(randomUUID())).status).toBe(404);
      const res = await remove("not-a-uuid");
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("NOT_FOUND");
    });
  });
});
