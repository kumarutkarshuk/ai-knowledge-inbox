import { afterEach, describe, expect, it, vi } from "vitest";
import { URL_CONTENT_MAX_CHARS } from "../constants.js";
import { stubJina } from "../test/fakeJina.js";
import { extractUrl } from "./extract.js";

const url = "https://example.com/post";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("extractUrl", () => {
  it("calls Jina Reader with JSON accept and the key, and returns title + content", async () => {
    const fetchMock = stubJina({ [url]: { title: " Post ", content: "Hello world" } });
    expect(await extractUrl(url, "key")).toEqual({ title: "Post", content: "Hello world" });
    const [called, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(called).toBe(`https://r.jina.ai/${url}`);
    expect(init.headers).toMatchObject({ Accept: "application/json", Authorization: "Bearer key" });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("cuts content off at URL_CONTENT_MAX_CHARS", async () => {
    stubJina({ [url]: { content: "a".repeat(URL_CONTENT_MAX_CHARS + 10) } });
    const { content, title } = await extractUrl(url, "key");
    expect(content).toHaveLength(URL_CONTENT_MAX_CHARS);
    expect(title).toBeNull();
  });

  it("removes NUL chars that Postgres cannot store", async () => {
    stubJina({ [url]: { title: "a\u0000b", content: "x\u0000y" } });
    expect(await extractUrl(url, "key")).toEqual({ title: "ab", content: "xy" });
  });

  it("throws on whitespace-only content", async () => {
    stubJina({ [url]: { title: "t", content: " \n\t " } });
    await expect(extractUrl(url, "key")).rejects.toThrow("No text content found");
  });

  it("throws on a non-2xx response", async () => {
    stubJina({ [url]: { status: 502 } });
    await expect(extractUrl(url, "key")).rejects.toThrow("HTTP 502");
  });

  it("passes a network error through", async () => {
    stubJina({ [url]: new TypeError("fetch failed") });
    await expect(extractUrl(url, "key")).rejects.toThrow("fetch failed");
  });
});
