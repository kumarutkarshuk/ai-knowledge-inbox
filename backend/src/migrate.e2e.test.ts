import { readdirSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MIGRATIONS_SCHEMA, MIGRATIONS_TABLE } from "./constants.js";
import { MIGRATIONS_DIR, runMigrations } from "./migrate.js";
import { adminUrl, createTestDb, type TestDb } from "./test/testDb.js";

function files() {
  return readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".sql"))
    .map((file) => file.replace(/\.sql$/, ""))
    .sort();
}

describe.skipIf(!adminUrl)("runMigrations", () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await createTestDb();
  });

  afterAll(async () => {
    await db?.drop();
  });

  it("records every migration file in its own schema", async () => {
    const { rows } = await db.pool.query(
      `select name from ${MIGRATIONS_SCHEMA}.${MIGRATIONS_TABLE} order by run_on, id`,
    );
    expect(rows.map((r) => r.name)).toEqual(files());
  });

  it("applies nothing on a second run", async () => {
    expect(await runMigrations(db.pool)).toEqual([]);
  });

  it("applies each migration once when two servers start at the same time", async () => {
    const fresh = await createTestDb({ migrate: false });
    try {
      const [one, two] = await Promise.all([runMigrations(fresh.pool), runMigrations(fresh.pool)]);
      expect([...one, ...two]).toEqual(files());
    } finally {
      await fresh.drop();
    }
  });

  it("returns the connection without leftover session state", async () => {
    await runMigrations(db.pool);
    const { rows } = await db.pool.query("show lock_timeout");
    expect(rows[0].lock_timeout).toBe("0");
    expect(db.pool.totalCount).toBe(db.pool.idleCount);
  });

  it("does not put the migrations table in the public schema", async () => {
    const { rows } = await db.pool.query(
      "select table_schema from information_schema.tables where table_name = $1",
      [MIGRATIONS_TABLE],
    );
    expect(rows).toEqual([{ table_schema: MIGRATIONS_SCHEMA }]);
  });
});
