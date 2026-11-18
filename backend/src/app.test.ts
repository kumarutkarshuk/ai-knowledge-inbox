import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";

const origin = "http://localhost:5173";
const app = createApp({ FRONTEND_ORIGIN: origin });

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
  it("returns 404 NOT_FOUND for an unknown route", async () => {
    const res = await request(app).get("/nope");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: { code: "NOT_FOUND", message: "Route not found" } });
  });

  it("returns 400 INVALID_JSON for a malformed body", async () => {
    const res = await request(app)
      .post("/nope")
      .set("Content-Type", "application/json")
      .send('{"a":');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_JSON");
  });

  it("returns 413 PAYLOAD_TOO_LARGE for a body over 1mb", async () => {
    const res = await request(app)
      .post("/nope")
      .set("Content-Type", "application/json")
      .send(JSON.stringify({ a: "x".repeat(1024 * 1024) }));
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe("PAYLOAD_TOO_LARGE");
  });

  it("accepts a body just under 1mb", async () => {
    const res = await request(app)
      .post("/nope")
      .set("Content-Type", "application/json")
      .send(JSON.stringify({ a: "x".repeat(1024 * 1024 - 20) }));
    expect(res.status).toBe(404);
  });
});
