import express from "express";
import jwt from "jsonwebtoken";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { signToken } from "../auth.js";
import { errorHandler } from "./errorHandler.js";
import { requireAuth } from "./requireAuth.js";

const secret = "test-token-secret-that-is-32-chars";
const unauthorized = { error: { code: "UNAUTHORIZED", message: "Login required" } };

const app = express();
app.use(requireAuth(secret));
app.get("/secret", (_req, res) => {
  res.json({ ok: true });
});
app.use(errorHandler);

afterEach(() => {
  vi.useRealTimers();
});

describe("requireAuth", () => {
  it("lets a valid Bearer token through", async () => {
    const res = await request(app)
      .get("/secret")
      .set("Authorization", `Bearer ${signToken(secret).token}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it("accepts the Bearer scheme in any case", async () => {
    const res = await request(app)
      .get("/secret")
      .set("Authorization", `bearer ${signToken(secret).token}`);
    expect(res.status).toBe(200);
  });

  it("returns 401 when the header is missing", async () => {
    const res = await request(app).get("/secret");
    expect(res.status).toBe(401);
    expect(res.body).toEqual(unauthorized);
  });

  it("returns 401 for another scheme or an empty token", async () => {
    const { token } = signToken(secret);
    for (const header of [`Basic ${token}`, token, "Bearer", "Bearer "]) {
      const res = await request(app).get("/secret").set("Authorization", header);
      expect(res.status).toBe(401);
      expect(res.body).toEqual(unauthorized);
    }
  });

  it("returns 401 for an expired token", async () => {
    vi.useFakeTimers({ now: new Date("2026-01-01T00:00:00.000Z"), toFake: ["Date"] });
    const { token } = signToken(secret);
    vi.useRealTimers();
    const res = await request(app).get("/secret").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(401);
    expect(res.body).toEqual(unauthorized);
  });

  it("returns 401 for a token signed with the wrong secret", async () => {
    const token = jwt.sign({ sub: "owner" }, "wrong-secret-wrong-secret-wrong-secret", {
      algorithm: "HS256",
      expiresIn: "1h",
    });
    const res = await request(app).get("/secret").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(401);
    expect(res.body).toEqual(unauthorized);
  });

  it("returns 401 for a malformed token", async () => {
    const res = await request(app).get("/secret").set("Authorization", "Bearer abc.def.ghi");
    expect(res.status).toBe(401);
  });
});
