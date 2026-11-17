import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { envWithout, validEnv } from './fixtures.js';

const apiDir = fileURLToPath(new URL('..', import.meta.url));
const tsxLoader = import.meta.resolve('tsx');
const entry = join(apiDir, 'src', 'index.ts');
const emptyDir = mkdtempSync(join(tmpdir(), 'aki-api-'));

let child: ChildProcess | undefined;

afterEach(() => {
  child?.kill();
  child = undefined;
});

afterAll(() => {
  rmSync(emptyDir, { recursive: true, force: true });
});

function start(env: Record<string, string>) {
  child = spawn(process.execPath, ['--import', tsxLoader, '--conditions=source', entry], {
    cwd: emptyDir,
    env: { PATH: process.env.PATH ?? '', ...env },
  });
  let stdout = '';
  let stderr = '';
  child.stdout?.on('data', (d) => (stdout += d));
  child.stderr?.on('data', (d) => (stderr += d));
  const exited = new Promise<number | null>((resolve) => child?.on('exit', resolve));
  return { exited, output: () => ({ stdout, stderr }) };
}

function freePort() {
  return new Promise<number>((resolve) => {
    const server = createServer();
    server.listen(0, () => {
      const address = server.address();
      server.close(() => resolve(typeof address === 'object' && address ? address.port : 0));
    });
  });
}

async function waitForHealth(port: number) {
  for (let i = 0; i < 100; i++) {
    try {
      return await fetch(`http://localhost:${port}/health`);
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw new Error('server did not start');
}

describe('api server process', () => {
  it('serves GET /health on PORT', async () => {
    const port = await freePort();
    start({ ...validEnv, PORT: String(port) });
    const res = await waitForHealth(port);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  }, 20_000);

  it('shuts down cleanly on SIGTERM', async () => {
    const port = await freePort();
    const { exited, output } = start({ ...validEnv, PORT: String(port) });
    await waitForHealth(port);
    child?.kill('SIGTERM');
    expect(await exited).toBe(0);
    expect(output().stdout).toContain('SIGTERM received');
  }, 20_000);

  it('exits with code 1 when the port is already in use', async () => {
    const blocker = createServer();
    await new Promise<void>((resolve) => blocker.listen(0, resolve));
    const address = blocker.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    const { exited, output } = start({ ...validEnv, PORT: String(port) });
    expect(await exited).toBe(1);
    expect(output().stderr).toContain('api failed to start');
    blocker.close();
  }, 20_000);

  it('exits with code 1 and a clear message when a required env var is missing', async () => {
    const { exited, output } = start(envWithout('GROQ_API_KEY'));
    expect(await exited).toBe(1);
    expect(output().stderr).toContain('Invalid environment variables');
    expect(output().stderr).toContain('GROQ_API_KEY');
  }, 20_000);
});
