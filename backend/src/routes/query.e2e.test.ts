import http from "node:http";
import type { AddressInfo } from "node:net";
import type pg from "pg";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../app.js";
import { signToken } from "../auth.js";
import { JINA_EMBEDDINGS_URL, NOT_FOUND_ANSWER } from "../constants.js";
import type { AnswerStream } from "../rag/answer.js";
import { fakeVector, stubJina } from "../test/fakeJina.js";
import { validEnv } from "../test/fixtures.js";
import {
  adminUrl,
  createTestDb,
  insertChunk,
  insertNote,
  softDelete,
  type TestDb,
} from "../test/testDb.js";
import type { Citation } from "../types/api.js";
import { STREAM_ERROR_MESSAGE } from "./query.js";

const auth = `Bearer ${signToken(validEnv.TOKEN_SECRET).token}`;
const queryVector = fakeVector(0);
const farVector = fakeVector(1);

interface ParsedEvent {
  event: string;
  data: unknown;
}

function parseEvents(body: string): ParsedEvent[] {
  return body
    .split("\n\n")
    .filter(Boolean)
    .map((block) => {
      const lines = block.split("\n");
      const event = lines.find((l) => l.startsWith("event: "))?.slice(7) ?? "";
      const data = lines.find((l) => l.startsWith("data: "))?.slice(6) ?? "null";
      return { event, data: JSON.parse(data) };
    });
}

function fakeAnswer(tokens: string[]) {
  return vi.fn<AnswerStream>(async function* () {
    yield* tokens;
  });
}

describe.skipIf(!adminUrl)("POST /query", () => {
  let db: TestDb;
  let pool: pg.Pool;
  let logs: string[];

  beforeAll(async () => {
    db = await createTestDb();
    pool = db.pool;
  });

  afterAll(async () => {
    await db?.drop();
  });

  beforeEach(async () => {
    await pool.query("truncate knowledge_base cascade");
    logs = [];
    const capture = (line: unknown) => void logs.push(String(line));
    vi.spyOn(console, "log").mockImplementation(capture);
    vi.spyOn(console, "error").mockImplementation(capture);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function readyNote(text: string, vector: number[]) {
    const note = await insertNote(pool, text, "READY");
    await insertChunk(pool, note.id, 0, vector);
    return note;
  }

  function ask(answer: AnswerStream, body: unknown) {
    return request(createApp(validEnv, pool, answer))
      .post("/query")
      .set("Authorization", auth)
      .send(body as object);
  }

  function queryLog() {
    const line = logs.find((l) => l.includes('"event":"query"'));
    return line ? JSON.parse(line) : undefined;
  }

  it("streams citations, then tokens, then done", async () => {
    const fetchMock = stubJina();
    const note = await readyNote("cats sleep a lot", queryVector);
    await readyNote("unrelated", farVector);
    const answer = fakeAnswer(["Cats sleep ", "a lot [1]."]);

    const res = await ask(answer, { query: "  do cats sleep?  " });

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/^text\/event-stream/);
    expect(res.headers["cache-control"]).toBe("no-cache");
    expect(res.headers["x-accel-buffering"]).toBe("no");
    const events = parseEvents(res.text);
    expect(events.map((e) => e.event)).toEqual(["citations", "token", "token", "done"]);
    expect(events[0]?.data).toEqual([
      {
        n: 1,
        itemId: note.id,
        type: "NOTE",
        title: "",
        sourceUrl: null,
        snippet: "chunk 0",
        similarity: 1,
      } satisfies Citation,
    ]);
    expect(events.slice(1, 3).map((e) => e.data)).toEqual([
      { text: "Cats sleep " },
      { text: "a lot [1]." },
    ]);
    expect(events[3]?.data).toEqual({});

    const [, embedInit] = fetchMock.mock.calls.find(([url]) => url === JINA_EMBEDDINGS_URL) ?? [];
    expect(JSON.parse(String(embedInit?.body))).toMatchObject({
      task: "retrieval.query",
      input: ["do cats sleep?"],
    });
    expect(answer).toHaveBeenCalledOnce();
    const [query, rows] = answer.mock.calls[0] as Parameters<AnswerStream>;
    expect(query).toBe("do cats sleep?");
    expect(rows.map((r) => r.item_id)).toEqual([note.id]);
    expect(queryLog()).toMatchObject({ result: "ANSWERED", chunks: 1, llm: true });
  });

  it("returns at most 5 citations, best match first", async () => {
    stubJina();
    for (let i = 0; i < 7; i++) {
      const vector = fakeVector(0);
      vector[1] = i / 10;
      await readyNote(`note ${i}`, vector);
    }
    const res = await ask(fakeAnswer(["ok"]), { query: "q" });
    const citations = parseEvents(res.text)[0]?.data as Citation[];
    expect(citations.map((c) => c.n)).toEqual([1, 2, 3, 4, 5]);
    const sims = citations.map((c) => c.similarity);
    expect(sims).toEqual([...sims].sort((a, b) => b - a));
  });

  it("sends the not-found answer without calling the LLM when nothing matches", async () => {
    stubJina();
    await readyNote("unrelated", farVector);
    const answer = fakeAnswer(["should not run"]);

    const res = await ask(answer, { query: "anything" });

    expect(parseEvents(res.text)).toEqual([
      { event: "citations", data: [] },
      { event: "token", data: { text: NOT_FOUND_ANSWER } },
      { event: "done", data: {} },
    ]);
    expect(answer).not.toHaveBeenCalled();
    expect(queryLog()).toMatchObject({ result: "NOT_FOUND", chunks: 0, llm: false });
  });

  it("logs NOT_FOUND when the LLM replies not found", async () => {
    stubJina();
    await readyNote("cats", queryVector);
    const res = await ask(fakeAnswer([NOT_FOUND_ANSWER]), { query: "dogs?" });
    expect(parseEvents(res.text).map((e) => e.event)).toEqual(["citations", "token", "done"]);
    expect(queryLog()).toMatchObject({ result: "NOT_FOUND", chunks: 1, llm: true });
  });

  it("never cites a deleted item or an item that is not READY", async () => {
    stubJina();
    const deleted = await readyNote("deleted", queryVector);
    await softDelete(pool, deleted.id);
    const pending = await insertNote(pool, "pending", "PROCESSING");
    await insertChunk(pool, pending.id, 0, queryVector);
    const answer = fakeAnswer(["x"]);

    const res = await ask(answer, { query: "deleted" });

    expect(parseEvents(res.text)[0]).toEqual({ event: "citations", data: [] });
    expect(answer).not.toHaveBeenCalled();
  });

  it.each([
    ["a 1001-char query", { query: "a".repeat(1001) }],
    ["an empty query", { query: "   " }],
    ["a missing query", {}],
    ["a non-string query", { query: 5 }],
  ])("returns 400 JSON for %s", async (_name, body) => {
    const fetchMock = stubJina();
    const res = await ask(fakeAnswer([]), body);
    expect(res.status).toBe(400);
    expect(res.headers["content-type"]).toMatch(/^application\/json/);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("accepts a query of exactly 1000 chars", async () => {
    stubJina();
    const res = await ask(fakeAnswer([]), { query: "a".repeat(1000) });
    expect(res.status).toBe(200);
  });

  it("needs a token", async () => {
    const res = await request(createApp(validEnv, pool, fakeAnswer([])))
      .post("/query")
      .send({ query: "x" });
    expect(res.status).toBe(401);
  });

  it("sends an error event when the embedding call fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("down", { status: 503 })),
    );
    const res = await ask(fakeAnswer([]), { query: "x" });
    expect(res.status).toBe(200);
    expect(parseEvents(res.text)).toEqual([
      { event: "error", data: { message: STREAM_ERROR_MESSAGE } },
    ]);
    expect(queryLog()).toMatchObject({ result: "ERROR" });
  });

  it("sends an error event when the LLM fails mid-stream", async () => {
    stubJina();
    await readyNote("cats", queryVector);
    const answer = vi.fn<AnswerStream>(async function* () {
      yield "partial";
      throw new Error("groq exploded");
    });
    const res = await ask(answer, { query: "x" });
    expect(parseEvents(res.text).map((e) => e.event)).toEqual(["citations", "token", "error"]);
    expect(queryLog()).toMatchObject({ result: "ERROR", error: "groq exploded" });
  });

  it("aborts the LLM stream when the client disconnects", async () => {
    stubJina();
    await readyNote("cats", queryVector);
    let llmSignal: AbortSignal | undefined;
    const answer: AnswerStream = async function* (_q, _rows, signal) {
      llmSignal = signal;
      yield "first";
      await new Promise((resolve) => signal.addEventListener("abort", resolve));
      yield "never sent";
    };
    const server = createApp(validEnv, pool, answer).listen(0);
    try {
      const { port } = server.address() as AddressInfo;
      await new Promise<void>((resolve, reject) => {
        const req = http.request(
          {
            port,
            method: "POST",
            path: "/query",
            headers: { Authorization: auth, "Content-Type": "application/json" },
          },
          (res) => {
            res.on("data", (chunk: Buffer) => {
              if (chunk.toString().includes("first")) {
                req.destroy();
                resolve();
              }
            });
          },
        );
        req.on("error", (err) => {
          if (!req.destroyed) reject(err);
        });
        req.end(JSON.stringify({ query: "cats" }));
      });
      await vi.waitFor(() => expect(llmSignal?.aborted).toBe(true));
      await vi.waitFor(() => expect(queryLog()).toMatchObject({ result: "ABORTED", llm: true }));
    } finally {
      server.close();
    }
  });
});
