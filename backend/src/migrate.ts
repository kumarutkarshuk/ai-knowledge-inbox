import path from "node:path";
import { runner } from "node-pg-migrate";
import type pg from "pg";
import { MIGRATION_LOCK_TIMEOUT_MS, MIGRATIONS_SCHEMA, MIGRATIONS_TABLE } from "./constants.js";

export const MIGRATIONS_DIR = path.resolve(import.meta.dirname, "..", "migrations");

const ignore = () => undefined;

export async function runMigrations(pool: pg.Pool): Promise<string[]> {
  const client = await pool.connect();
  const onError = (err: Error) => console.error(`Migration client error: ${err.message}`);
  client.on("error", onError);
  try {
    await client.query(`set lock_timeout = ${MIGRATION_LOCK_TIMEOUT_MS}`);
    const applied = await runner({
      dbClient: client,
      dir: MIGRATIONS_DIR,
      ignorePattern: "\\..*|.*(?<!\\.sql)",
      direction: "up",
      migrationsSchema: MIGRATIONS_SCHEMA,
      createMigrationsSchema: true,
      migrationsTable: MIGRATIONS_TABLE,
      advisoryLockMode: "wait",
      logger: { debug: ignore, info: ignore, warn: console.warn, error: console.error },
    });
    return applied.map((migration) => migration.name);
  } finally {
    client.off("error", onError);
    client.release(true);
  }
}
