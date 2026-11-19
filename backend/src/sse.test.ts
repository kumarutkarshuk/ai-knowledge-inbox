import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { formatSse, openSse } from "./sse.js";

describe("formatSse", () => {
  it("writes the event name and JSON data, ended by a blank line", () => {
    expect(formatSse({ event: "token", data: { text: "hi" } })).toBe(
      'event: token\ndata: {"text":"hi"}\n\n',
    );
    expect(formatSse({ event: "done", data: {} })).toBe("event: done\ndata: {}\n\n");
  });

  it("keeps newlines in the text on one data line", () => {
    expect(formatSse({ event: "token", data: { text: "a\n\nb" } })).toBe(
      'event: token\ndata: {"text":"a\\n\\nb"}\n\n',
    );
  });
});

describe("openSse", () => {
  it("sends the no-buffering SSE headers", async () => {
    const app = express().get("/", (_req, res) => {
      openSse(res);
      res.end();
    });
    const res = await request(app).get("/");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/^text\/event-stream/);
    expect(res.headers["cache-control"]).toBe("no-cache");
    expect(res.headers["x-accel-buffering"]).toBe("no");
  });
});
