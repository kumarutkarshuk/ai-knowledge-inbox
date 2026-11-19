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
  releaseJob,
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

interface JobContext {
  pool: pg.Pool;
  apiKey: string;
  signal: AbortSignal;
}

async function processJob({ pool, apiKey, signal }: JobContext, job: KnowledgeBaseRow) {
  let text = job.raw_content ?? "";
  if (job.type === "URL") {
    const page = await extractUrl(job.source_url as string, apiKey, signal);
    await withTimedTransaction(pool, (client) => saveUrlContent(client, job.id, page));
    text = page.content;
  }
  const pieces = await chunkText(text);
  if (pieces.length === 0) throw new Error("No text content found");
  const vectors = await embedPassages(pieces, apiKey, signal);
  const chunks = pieces.map((content, i) => ({ content, embedding: vectors[i] as number[] }));
  const saved = await withTimedTransaction(pool, (client) =>
    saveChunksAndMarkReady(client, job.id, chunks),
  );
  return { result: saved ? "READY" : "SKIPPED", chunks: chunks.length };
}

async function release(ctx: JobContext, job: KnowledgeBaseRow, log: object, started: number) {
  try {
    await withTimedTransaction(ctx.pool, (client) => releaseJob(client, job.id));
    console.log(JSON.stringify({ ...log, result: "RELEASED", durationMs: Date.now() - started }));
  } catch (err) {
    console.error(`Worker could not release ${job.id}:`, err);
  }
}

async function runJob(ctx: JobContext, job: KnowledgeBaseRow): Promise<void> {
  const started = Date.now();
  const log = { event: "worker.job", id: job.id, type: job.type };
  if (ctx.signal.aborted) return release(ctx, job, log, started);
  try {
    const outcome = await processJob(ctx, job);
    console.log(JSON.stringify({ ...log, ...outcome, durationMs: Date.now() - started }));
  } catch (err) {
    if (ctx.signal.aborted) return release(ctx, job, log, started);
    const failure = decideFailure(job.retry_count, err);
    let recorded = true;
    try {
      await withTimedTransaction(ctx.pool, (client) => recordJobFailure(client, job.id, failure));
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

async function runOnce(ctx: JobContext): Promise<void> {
  try {
    const reset = await withTimedTransaction(ctx.pool, (client) =>
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
    const jobs = await withTimedTransaction(ctx.pool, (client) => claimJobs(client, JOBS_PER_RUN));
    for (const job of jobs) await runJob(ctx, job);
  } catch (err) {
    console.error(JSON.stringify({ event: "worker.run", result: "ERROR", error: errorText(err) }));
  }
}

export function createWorker(pool: pg.Pool, apiKey: string) {
  const controller = new AbortController();
  const ctx: JobContext = { pool, apiKey, signal: controller.signal };
  let current: Promise<void> | undefined;

  async function run(): Promise<boolean> {
    if (current || controller.signal.aborted) return false;
    current = runOnce(ctx);
    try {
      await current;
    } finally {
      current = undefined;
    }
    return true;
  }

  async function stop(): Promise<void> {
    controller.abort();
    await current;
  }

  return { run, stop };
}
