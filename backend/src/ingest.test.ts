import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decideIngest, hashNote, normalizeUrl, noteTitle } from "./ingest.js";

describe("normalizeUrl", () => {
  it.each([
    ["HTTPS://Example.com/Blog/Post/#intro", "https://example.com/Blog/Post"],
    ["https://Example.com/a/#x", "https://example.com/a"],
    ["https://example.com/a", "https://example.com/a"],
    ["https://example.com/a///", "https://example.com/a"],
    ["https://example.com", "https://example.com/"],
    ["https://example.com/#top", "https://example.com/"],
    ["https://example.com/a/?q=1&B=2#x", "https://example.com/a?q=1&B=2"],
    ["http://EXAMPLE.com:80/a/", "http://example.com/a"],
    ["https://example.com:8443/a", "https://example.com:8443/a"],
  ])("%s -> %s", (input, expected) => {
    expect(normalizeUrl(input)).toBe(expected);
  });

  it("keeps the path case and the query string", () => {
    expect(normalizeUrl("https://example.com/A?X=Y")).toBe("https://example.com/A?X=Y");
  });

  it("throws on an invalid URL", () => {
    expect(() => normalizeUrl("not a url")).toThrow();
  });
});

describe("hashNote", () => {
  it("is the sha256 hex of the trimmed text", () => {
    expect(hashNote("  hi \n")).toBe(createHash("sha256").update("hi").digest("hex"));
  });

  it("gives the same hash for extra outer whitespace only", () => {
    expect(hashNote("hello world")).toBe(hashNote("\t hello world  \n"));
    expect(hashNote("hello world")).not.toBe(hashNote("hello  world"));
  });
});

describe("noteTitle", () => {
  it("uses the trimmed user title", () => {
    expect(noteTitle("content", "  My title ")).toBe("My title");
  });

  it("falls back to the first 60 chars of the trimmed content", () => {
    const content = `  ${"a".repeat(59)}bc  `;
    expect(noteTitle(content)).toBe(`${"a".repeat(59)}b`);
    expect(noteTitle(content, "   ")).toBe(`${"a".repeat(59)}b`);
  });
});

describe("decideIngest", () => {
  const now = new Date();

  it("inserts when there is no match", () => {
    expect(decideIngest(undefined)).toBe("INSERT");
  });

  it.each(["SUBMITTED", "PROCESSING", "READY", "FAILED"] as const)(
    "conflicts with an active %s item",
    (status) => {
      expect(decideIngest({ status, deleted_at: null })).toBe("CONFLICT");
    },
  );

  it("restores a deleted READY item as it is", () => {
    expect(decideIngest({ status: "READY", deleted_at: now })).toBe("RESTORE");
  });

  it("restores and re-queues a deleted FAILED item", () => {
    expect(decideIngest({ status: "FAILED", deleted_at: now })).toBe("RESTORE_AND_REQUEUE");
  });
});
