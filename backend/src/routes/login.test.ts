import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../app.js";
import type pg from "pg";
import { validEnv } from "../test/fixtures.js";

function newApp() {
  return createApp(validEnv, {} as pg.Pool);
}

function login(app: ReturnType<typeof newApp>, body: unknown, ip?: string) {
  const req = request(app).post("/login");
  if (ip) req.set("X-Forwarded-For", ip);
  return req.send(body as object);
}

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /login", () => {
  it("returns 401 UNAUTHORIZED for a wrong password and logs the client IP", async () => {
    const res = await login(newApp(), { password: "wrong" }, "203.0.113.5");
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: { code: "UNAUTHORIZED", message: "Wrong password" } });
    expect(console.warn).toHaveBeenCalledWith("Wrong login password from 203.0.113.5");
  });

  it("does not trim the password", async () => {
    const res = await login(newApp(), { password: validEnv.APP_PASSWORD.trim() });
    expect(res.status).toBe(401);
  });

  it("returns 413 for a body over 1kb", async () => {
    const res = await login(newApp(), { password: "x".repeat(1100) });
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe("PAYLOAD_TOO_LARGE");
  });

  it("returns a token and expiresAt for the right password", async () => {
    const res = await login(newApp(), { password: validEnv.APP_PASSWORD });
    expect(res.status).toBe(200);
    expect(typeof res.body.token).toBe("string");
    const days = (Date.parse(res.body.expiresAt) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.99);
    expect(days).toBeLessThanOrEqual(7);
  });

  it("returns 400 VALIDATION_ERROR when the password is missing or not a string", async () => {
    const app = newApp();
    for (const body of [{}, { password: 123 }, { password: "" }]) {
      const res = await login(app, body);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    }
  });

  it("returns 429 on the 6th attempt within a minute, even with the right password", async () => {
    const app = newApp();
    for (let i = 0; i < 5; i++) {
      expect((await login(app, { password: "wrong" })).status).toBe(401);
    }
    const res = await login(app, { password: validEnv.APP_PASSWORD });
    expect(res.status).toBe(429);
    expect(res.body).toEqual({
      error: { code: "TOO_MANY_REQUESTS", message: "Too many login attempts, try again later" },
    });
    expect(console.warn).toHaveBeenLastCalledWith(
      expect.stringContaining("Login rate limited for"),
    );
  });

  it("limits each client IP from X-Forwarded-For separately", async () => {
    const app = newApp();
    for (let i = 0; i < 5; i++) {
      await login(app, { password: "wrong" }, "203.0.113.1");
    }
    expect((await login(app, { password: "wrong" }, "203.0.113.1")).status).toBe(429);
    expect((await login(app, { password: "wrong" }, "203.0.113.2")).status).toBe(401);
  });

  it("does not let a client reset its limit with a spoofed left-most X-Forwarded-For", async () => {
    const app = newApp();
    for (let i = 0; i < 5; i++) {
      await login(app, { password: "wrong" }, `10.0.0.${i}, 203.0.113.9`);
    }
    expect((await login(app, { password: "wrong" }, "10.0.0.99, 203.0.113.9")).status).toBe(429);
  });

  it("does not rate limit other routes", async () => {
    const app = newApp();
    for (let i = 0; i < 6; i++) await login(app, { password: "wrong" });
    expect((await request(app).get("/health")).status).toBe(200);
  });
});

describe("protected routes", () => {
  it("rejects requests without a token and accepts the login token", async () => {
    const app = newApp();
    const noToken = await request(app).get("/items");
    expect(noToken.status).toBe(401);
    expect(noToken.body.error.code).toBe("UNAUTHORIZED");

    const { body } = await login(app, { password: validEnv.APP_PASSWORD });
    const withToken = await request(app).get("/items").set("Authorization", `Bearer ${body.token}`);
    expect(withToken.status).not.toBe(401);
  });

  it("rejects a tampered login token", async () => {
    const app = newApp();
    const { body } = await login(app, { password: validEnv.APP_PASSWORD });
    const tampered = `${body.token.slice(0, -2)}xx`;
    const res = await request(app).get("/items").set("Authorization", `Bearer ${tampered}`);
    expect(res.status).toBe(401);
  });

  it("keeps /health public", async () => {
    const res = await request(newApp()).get("/health");
    expect(res.status).toBe(200);
  });
});
