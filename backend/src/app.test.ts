import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { signToken } from "./auth.js";
import type pg from "pg";
import { validEnv } from "./test/fixtures.js";

const origin = validEnv.FRONTEND_ORIGIN;
const app = createApp(validEnv, {} as pg.Pool);
const auth = `Bearer ${signToken(validEnv.TOKEN_SECRET).token}`;

describe("GET /health", () => {
  it("returns status ok", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });

  it("sends the CORS header for FRONTEND_ORIGIN", async () => {
    const res = await request(app).get("/health").set("Origin", origin);
    expect(res.headers["access-control-allow-origin"]).toBe(origin);
  });

  it("works without an auth header", async () => {
    const res = await request(app).get("/health").set("Authorization", "");
    expect(res.status).toBe(200);
  });
});

describe("CORS", () => {
  it("answers a preflight with FRONTEND_ORIGIN only", async () => {
    const res = await request(app)
      .options("/items")
      .set("Origin", "https://evil.example.com")
      .set("Access-Control-Request-Method", "POST");
    expect(res.status).toBe(204);
    expect(res.headers["access-control-allow-origin"]).toBe(origin);
  });
});

describe("error shape", () => {
  it("returns 401 UNAUTHORIZED for an unknown route without a token", async () => {
    const res = await request(app).get("/nope");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  it("does not parse the body of a request without a token", async () => {
    const res = await request(app)
      .post("/nope")
      .set("Content-Type", "application/json")
      .send('{"a":');
    expect(res.status).toBe(401);
  });

  it("returns 404 NOT_FOUND for an unknown route", async () => {
    const res = await request(app).get("/nope").set("Authorization", auth);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: { code: "NOT_FOUND", message: "Route not found" } });
  });

  it("returns 400 INVALID_JSON for a malformed body", async () => {
    const res = await request(app)
      .post("/nope")
      .set("Authorization", auth)
      .set("Content-Type", "application/json")
      .send('{"a":');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_JSON");
  });

  it("returns 413 PAYLOAD_TOO_LARGE for a body over 1mb", async () => {
    const res = await request(app)
      .post("/nope")
      .set("Authorization", auth)
      .set("Content-Type", "application/json")
      .send(JSON.stringify({ a: "x".repeat(1024 * 1024) }));
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe("PAYLOAD_TOO_LARGE");
  });

  it("accepts a body just under 1mb", async () => {
    const res = await request(app)
      .post("/nope")
      .set("Authorization", auth)
      .set("Content-Type", "application/json")
      .send(JSON.stringify({ a: "x".repeat(1024 * 1024 - 20) }));
    expect(res.status).toBe(404);
  });
});
