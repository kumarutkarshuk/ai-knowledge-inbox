import { afterEach, describe, expect, it } from "vitest";
import type pg from "pg";
import { DB_CONNECT_TIMEOUT_MS } from "./constants.js";
import { createPool } from "./db.js";
import { validEnv } from "./test/fixtures.js";

describe("createPool", () => {
  let pool: pg.Pool | undefined;

  afterEach(async () => {
    await pool?.end();
  });

  it("uses DATABASE_URL with SSL on by default", () => {
    pool = createPool(validEnv.DATABASE_URL);
    expect(pool.options.connectionString).toBe(validEnv.DATABASE_URL);
    expect(pool.options.ssl).toEqual({ rejectUnauthorized: false });
    expect(pool.options.connectionTimeoutMillis).toBe(DB_CONNECT_TIMEOUT_MS);
    expect(pool.listenerCount("error")).toBe(1);
  });
});
