import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { validEnv } from "./test/fixtures.js";
import { adminUrl, createTestDb, type TestDb } from "./test/testDb.js";

const root = path.resolve(import.meta.dirname, "..");
const tsx = path.join(root, "node_modules", ".bin", "tsx");
const entry = path.join(root, "src", "index.ts");
const emptyDir = mkdtempSync(path.join(tmpdir(), "backend-e2e-"));

async function stop(child: ReturnType<typeof start>) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill();
  await once(child, "exit");
}

function start(env: Record<string, string>) {
  return spawn(tsx, [entry], {
    cwd: emptyDir,
    env: { PATH: process.env.PATH ?? "", ...env },
  });
}

afterAll(() => {
  rmSync(emptyDir, { recursive: true, force: true });
});

describe.skipIf(!adminUrl)("backend process with a database", () => {
  let db: TestDb;
  let env: Record<string, string>;

  beforeAll(async () => {
    db = await createTestDb({ migrate: false });
    env = { ...validEnv, DATABASE_URL: db.url };
  });

  afterAll(async () => {
    await db?.drop();
  });

  it("applies migrations, then serves GET /health", async () => {
    const child = start(env);
    let stdout = "";
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    try {
      const port = await new Promise<number>((resolve, reject) => {
        child.stdout.on("data", (chunk: Buffer) => {
          stdout += chunk.toString();
          const match = /listening on port (\d+)/.exec(stdout);
          if (match?.[1]) resolve(Number(match[1]));
        });
        child.on("exit", (code) => reject(new Error(`exited with ${code}: ${stderr}`)));
      });
      const res = await fetch(`http://localhost:${port}/health`);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe('{"status":"ok"}');
      const base = `http://localhost:${port}`;
      expect((await fetch(`${base}/items`)).status).toBe(401);
      const login = await fetch(`${base}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: env.APP_PASSWORD }),
      });
      expect(login.status).toBe(200);
      const { token } = (await login.json()) as { token: string };
      const authed = await fetch(`${base}/items`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(authed.status).toBe(200);
      expect(await authed.json()).toEqual({ items: [] });
      expect(stdout).toContain("Migrations applied: 0001_init");
      const { rows } = await db.pool.query("select to_regclass('public.knowledge_base') as t");
      expect(rows[0].t).toBe("knowledge_base");
    } finally {
      await stop(child);
    }
  }, 30_000);

  it("exits with a clear message when the port is taken", async () => {
    const blocker = createServer().listen(0);
    await once(blocker, "listening");
    const { port } = blocker.address() as AddressInfo;
    try {
      const child = start({ ...env, PORT: String(port) });
      let stderr = "";
      child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
      const [code] = await once(child, "exit");
      expect(code).toBe(1);
      expect(stderr).toContain("Server failed to start");
    } finally {
      blocker.close();
    }
  }, 30_000);
});

describe("backend process", () => {
  it("exits with a clear message when a required var is missing", async () => {
    const { JINA_API_KEY: _jina, ...rest } = validEnv;
    const child = start(rest);
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    const code = await new Promise<number | null>((resolve) => child.on("exit", resolve));
    expect(code).toBe(1);
    expect(stderr).toContain("Invalid environment variables");
    expect(stderr).toContain("- JINA_API_KEY: missing");
  });

  it("exits with a clear message when migrations fail", async () => {
    const child = start({
      ...validEnv,
      DATABASE_URL: "postgres://postgres:postgres@localhost:1/postgres",
    });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    try {
      const [code] = await once(child, "exit");
      expect(code).toBe(1);
      expect(stderr).toContain("Migrations failed");
      expect(stderr).toContain("ECONNREFUSED");
    } finally {
      await stop(child);
    }
  }, 30_000);
});
