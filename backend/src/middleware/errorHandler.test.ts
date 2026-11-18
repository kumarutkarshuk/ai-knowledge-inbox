import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "../errors.js";
import { errorHandler } from "./errorHandler.js";

function appThatThrows(err: unknown) {
  const app = express();
  app.get("/boom", () => {
    throw err;
  });
  app.get("/async-boom", async () => {
    throw err;
  });
  app.use(errorHandler);
  return app;
}

describe("errorHandler", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses status and code from an HttpError", async () => {
    const res = await request(
      appThatThrows(new HttpError(409, "ALREADY_EXISTS", "Already saved")),
    ).get("/boom");
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: { code: "ALREADY_EXISTS", message: "Already saved" } });
  });

  it("handles errors thrown from async handlers", async () => {
    const res = await request(appThatThrows(new HttpError(400, "BAD", "bad"))).get("/async-boom");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("BAD");
  });

  it("returns 500 INTERNAL_ERROR and hides the message of an unknown error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await request(appThatThrows(new Error("db password leaked"))).get("/boom");
    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      error: { code: "INTERNAL_ERROR", message: "Something went wrong" },
    });
  });

  it("passes through other 4xx client errors", async () => {
    const err = Object.assign(new Error("unsupported charset"), {
      status: 415,
      type: "charset.unsupported",
    });
    const res = await request(appThatThrows(err)).get("/boom");
    expect(res.status).toBe(415);
    expect(res.body).toEqual({ error: { code: "BAD_REQUEST", message: "Invalid request" } });
  });

  it("returns 500 for a non-Error throw", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await request(appThatThrows("oops")).get("/boom");
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe("INTERNAL_ERROR");
  });
});
