import { describe, expect, it } from "vitest";
import { CHUNK_SIZE } from "../constants.js";
import { chunkText } from "./chunk.js";

describe("chunkText", () => {
  it("keeps a short text as one chunk", async () => {
    expect(await chunkText("A short note.")).toEqual(["A short note."]);
  });

  it("splits a long text into chunks of at most CHUNK_SIZE chars", async () => {
    const text = Array.from({ length: 600 }, (_, i) => `word${i}`).join(" ");
    const chunks = await chunkText(text);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.length <= CHUNK_SIZE)).toBe(true);
  });

  it("overlaps neighbouring chunks", async () => {
    const text = Array.from({ length: 600 }, (_, i) => `word${i}`).join(" ");
    const [a, b] = await chunkText(text);
    const tail = (a as string).split(" ").at(-1) as string;
    expect(b?.startsWith("word")).toBe(true);
    expect((b as string).split(" ")).toContain(tail);
  });

  it("covers the whole text", async () => {
    const text = Array.from({ length: 600 }, (_, i) => `word${i}`).join(" ");
    const joined = (await chunkText(text)).join(" ");
    expect(joined).toContain("word0 ");
    expect(joined).toContain("word599");
  });

  it("returns no chunks for empty text", async () => {
    expect(await chunkText("")).toEqual([]);
  });
});
