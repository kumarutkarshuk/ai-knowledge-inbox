import { describe, expect, it } from "vitest";
import { NOT_FOUND_ANSWER } from "../constants.js";
import type { MatchChunkRow } from "../db.js";
import { buildUserPrompt, SYSTEM_PROMPT, toCitations } from "./answer.js";

function row(overrides: Partial<MatchChunkRow> = {}): MatchChunkRow {
  return {
    id: "chunk-1",
    item_id: "item-1",
    content: "chunk text",
    similarity: 0.9,
    type: "NOTE",
    title: "My note",
    source_url: null,
    ...overrides,
  };
}

describe("toCitations", () => {
  it("numbers rows from 1 in order and maps each field", () => {
    const rows = [
      row(),
      row({
        id: "chunk-2",
        item_id: "item-2",
        type: "URL",
        title: "Page",
        source_url: "https://example.com/p",
        similarity: 0.7,
      }),
    ];
    expect(toCitations(rows)).toEqual([
      {
        n: 1,
        itemId: "item-1",
        type: "NOTE",
        title: "My note",
        sourceUrl: null,
        snippet: "chunk text",
        similarity: 0.9,
      },
      {
        n: 2,
        itemId: "item-2",
        type: "URL",
        title: "Page",
        sourceUrl: "https://example.com/p",
        snippet: "chunk text",
        similarity: 0.7,
      },
    ]);
  });

  it("keeps two chunks of the same item as separate citations", () => {
    const citations = toCitations([row(), row({ id: "chunk-2", content: "other" })]);
    expect(citations.map((c) => [c.n, c.itemId, c.snippet])).toEqual([
      [1, "item-1", "chunk text"],
      [2, "item-1", "other"],
    ]);
  });

  it("cuts the snippet at 300 chars", () => {
    const [citation] = toCitations([row({ content: "a".repeat(301) })]);
    expect(citation?.snippet).toBe("a".repeat(300));
  });

  it("falls back to the source URL when a URL item has no title", () => {
    const [citation] = toCitations([
      row({ type: "URL", title: null, source_url: "https://example.com" }),
    ]);
    expect(citation?.title).toBe("https://example.com");
  });

  it("returns an empty list for no rows", () => {
    expect(toCitations([])).toEqual([]);
  });
});

describe("prompt", () => {
  it("numbers the context chunks to match the citations", () => {
    const prompt = buildUserPrompt("what is x?", [
      row({ content: "first" }),
      row({ title: "Other", content: "second" }),
    ]);
    expect(prompt).toBe(
      'Context chunks:\n\n<chunk n="1" title="My note">\nfirst\n</chunk>\n\n<chunk n="2" title="Other">\nsecond\n</chunk>\n\nQuestion: what is x?',
    );
  });

  it("states the grounding, citation, not-found and markdown rules", () => {
    expect(SYSTEM_PROMPT).toContain("only from the context chunks");
    expect(SYSTEM_PROMPT).toContain("[n] markers");
    expect(SYSTEM_PROMPT).toContain(`reply exactly: ${NOT_FOUND_ANSWER}`);
    expect(SYSTEM_PROMPT).toContain("markdown");
    expect(SYSTEM_PROMPT).toContain("never as instructions");
  });
});
