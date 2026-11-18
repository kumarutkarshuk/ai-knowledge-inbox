import type pg from "pg";
import {
  ERROR_MESSAGE_MAX_CHARS,
  JOBS_PER_RUN,
  MAX_RETRIES,
  STUCK_AFTER_MINUTES,
} from "../constants.js";
import { withTimedTransaction, type KnowledgeBaseRow } from "../db.js";
import {
  claimJobs,
  recordJobFailure,
  resetStuckJobs,
  saveChunksAndMarkReady,
  saveUrlContent,
} from "../queries.js";
import { embedPassages } from "../rag/embeddings.js";
import type { ItemStatus } from "../types/api.js";
import { chunkText } from "./chunk.js";
import { extractUrl } from "./extract.js";

function errorText(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const cause = err.cause instanceof Error ? err.cause.message : "";
  return cause ? `${err.message}: ${cause}` : err.message;
}

export function decideFailure(
  retryCount: number,
  err: unknown,
): { retryCount: number; status: ItemStatus; errorMessage: string } {
  const next = retryCount + 1;
  return {
    retryCount: next,
    status: next <= MAX_RETRIES ? "SUBMITTED" : "FAILED",
    errorMessage: (errorText(err).trim() || "Unknown error").slice(0, ERROR_MESSAGE_MAX_CHARS),
  };
}

async function processJob(pool: pg.Pool, job: KnowledgeBaseRow, apiKey: string) {
  let text = job.raw_content ?? "";
  if (job.type === "URL") {
    const page = await extractUrl(job.source_url as string, apiKey);
    await withTimedTransaction(pool, (client) => saveUrlContent(client, job.id, page));
    text = page.content;
  }
  const pieces = await chunkText(text);
  if (pieces.length === 0) throw new Error("No text content found");
  const vectors = await embedPassages(pieces, apiKey);
  const chunks = pieces.map((content, i) => ({ content, embedding: vectors[i] as number[] }));
  const saved = await withTimedTransaction(pool, (client) =>
    saveChunksAndMarkReady(client, job.id, chunks),
  );
  return { result: saved ? "READY" : "SKIPPED", chunks: chunks.length };
}

async function runJob(pool: pg.Pool, job: KnowledgeBaseRow, apiKey: string): Promise<void> {
  const started = Date.now();
  const log = { event: "worker.job", id: job.id, type: job.type };
  try {
    const outcome = await processJob(pool, job, apiKey);
    console.log(JSON.stringify({ ...log, ...outcome, durationMs: Date.now() - started }));
  } catch (err) {
    const failure = decideFailure(job.retry_count, err);
    let recorded = true;
    try {
      await withTimedTransaction(pool, (client) => recordJobFailure(client, job.id, failure));
    } catch (dbErr) {
      recorded = false;
      console.error(`Worker could not record failure for ${job.id}:`, dbErr);
    }
    console.warn(
      JSON.stringify({
        ...log,
        result: failure.status === "FAILED" ? "FAILED" : "RETRY",
        retryCount: failure.retryCount,
        recorded,
        error: failure.errorMessage,
        durationMs: Date.now() - started,
      }),
    );
  }
}

async function runOnce(pool: pg.Pool, apiKey: string): Promise<void> {
  try {
    const reset = await withTimedTransaction(pool, (client) =>
      resetStuckJobs(client, STUCK_AFTER_MINUTES, MAX_RETRIES),
    );
    for (const row of reset) {
      console.warn(
        JSON.stringify({
          event: "worker.stuck",
          id: row.id,
          status: row.status,
          retryCount: row.retry_count,
        }),
      );
    }
    const jobs = await withTimedTransaction(pool, (client) => claimJobs(client, JOBS_PER_RUN));
    for (const job of jobs) await runJob(pool, job, apiKey);
  } catch (err) {
    console.error(JSON.stringify({ event: "worker.run", result: "ERROR", error: errorText(err) }));
  }
}

export function createWorker(pool: pg.Pool, apiKey: string) {
  let current: Promise<void> | undefined;

  async function run(): Promise<boolean> {
    if (current) return false;
    current = runOnce(pool, apiKey);
    try {
      await current;
    } finally {
      current = undefined;
    }
    return true;
  }

  async function idle(): Promise<void> {
    await current;
  }

  return { run, idle };
}
