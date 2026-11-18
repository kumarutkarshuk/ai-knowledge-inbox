import cron from "node-cron";
import type pg from "pg";
import { CRON_SCHEDULE } from "../constants.js";
import { createWorker } from "./jobs.js";

export function startWorker(pool: pg.Pool, apiKey: string) {
  const worker = createWorker(pool, apiKey);
  const task = cron.schedule(CRON_SCHEDULE, () => worker.run());
  return {
    async stop(): Promise<void> {
      await task.stop();
      await worker.idle();
    },
  };
}
