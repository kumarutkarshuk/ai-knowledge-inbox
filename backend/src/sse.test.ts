import { describe, expect, it } from "vitest";
import { formatSse } from "./sse.js";

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
