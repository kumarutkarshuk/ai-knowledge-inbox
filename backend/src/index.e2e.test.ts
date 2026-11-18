import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { validEnv } from "./test/fixtures.js";

const root = path.resolve(import.meta.dirname, "..");
const tsx = path.join(root, "node_modules", ".bin", "tsx");
const entry = path.join(root, "src", "index.ts");
const emptyDir = mkdtempSync(path.join(tmpdir(), "backend-e2e-"));

function start(env: Record<string, string>) {
  return spawn(tsx, [entry], {
    cwd: emptyDir,
    env: { PATH: process.env.PATH ?? "", ...env },
  });
}

afterAll(() => {
  rmSync(emptyDir, { recursive: true, force: true });
});

describe("backend process", () => {
  it("serves GET /health", async () => {
    const child = start(validEnv);
    try {
      const port = await new Promise<number>((resolve, reject) => {
        let stdout = "";
        child.stdout.on("data", (chunk: Buffer) => {
          stdout += chunk.toString();
          const match = /listening on port (\d+)/.exec(stdout);
          if (match?.[1]) resolve(Number(match[1]));
        });
        child.on("exit", (code) => reject(new Error(`exited with ${code}`)));
      });
      const res = await fetch(`http://localhost:${port}/health`);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe('{"status":"ok"}');
    } finally {
      child.kill();
    }
  });

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

  it("exits with a clear message when the port is taken", async () => {
    const blocker = createServer().listen(0);
    await once(blocker, "listening");
    const { port } = blocker.address() as AddressInfo;
    try {
      const child = start({ ...validEnv, PORT: String(port) });
      let stderr = "";
      child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
      const [code] = await once(child, "exit");
      expect(code).toBe(1);
      expect(stderr).toContain("Server failed to start");
    } finally {
      blocker.close();
    }
  });
});
