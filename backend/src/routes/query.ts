import { Router } from "express";
import type pg from "pg";
import { z } from "zod";
import { MIN_SIMILARITY, NOT_FOUND_ANSWER, QUERY_MAX_CHARS, TOP_K } from "../constants.js";
import { HttpError } from "../errors.js";
import { matchChunks } from "../queries.js";
import { toCitations, type AnswerStream } from "../rag/answer.js";
import { embedQuery } from "../rag/embeddings.js";
import { openSse, writeSse } from "../sse.js";

const querySchema = z.object({
  query: z
    .string("Query must be a string")
    .trim()
    .min(1, "Query is empty")
    .max(QUERY_MAX_CHARS, `Query is longer than ${QUERY_MAX_CHARS} chars`),
});

export const STREAM_ERROR_MESSAGE = "Could not answer the question. Try again.";

type QueryResult = "ANSWERED" | "NOT_FOUND" | "ABORTED" | "ERROR";

export function queryRouter(pool: pg.Pool, jinaApiKey: string, answer: AnswerStream) {
  const router = Router();

  router.post("/query", async (req, res) => {
    const parsed = querySchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, "VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid");
    }
    const { query } = parsed.data;
    const started = Date.now();
    const controller = new AbortController();
    res.on("close", () => {
      if (!res.writableFinished) controller.abort();
    });
    openSse(res);

    let chunks = 0;
    let llm = false;
    let result: QueryResult = "ANSWERED";
    let error: string | undefined;
    try {
      const embedding = await embedQuery(query, jinaApiKey, controller.signal);
      const rows = await matchChunks(pool, embedding, TOP_K, MIN_SIMILARITY);
      chunks = rows.length;
      controller.signal.throwIfAborted();
      writeSse(res, { event: "citations", data: toCitations(rows) });
      if (rows.length === 0) {
        result = "NOT_FOUND";
        writeSse(res, { event: "token", data: { text: NOT_FOUND_ANSWER } });
      } else {
        llm = true;
        let full = "";
        for await (const text of answer(query, rows, controller.signal)) {
          controller.signal.throwIfAborted();
          full += text;
          writeSse(res, { event: "token", data: { text } });
        }
        if (full.trim() === NOT_FOUND_ANSWER) result = "NOT_FOUND";
      }
      writeSse(res, { event: "done", data: {} });
    } catch (err) {
      result = controller.signal.aborted ? "ABORTED" : "ERROR";
      error = err instanceof Error ? err.message : String(err);
      if (result === "ERROR")
        writeSse(res, { event: "error", data: { message: STREAM_ERROR_MESSAGE } });
    } finally {
      res.end();
      const log = { event: "query", result, chunks, llm, error, durationMs: Date.now() - started };
      (result === "ERROR" ? console.error : console.log)(JSON.stringify(log));
    }
  });

  return router;
}
