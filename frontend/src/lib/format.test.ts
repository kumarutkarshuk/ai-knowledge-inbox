import { describe, expect, it } from "vitest";
import { formatDateTime } from "@/lib/format";

describe("formatDateTime", () => {
  it("shows the date and time without seconds", () => {
    const iso = "2026-11-18T10:00:45.000Z";
    const text = formatDateTime(iso);
    const seconds = new Date(iso).getSeconds().toString().padStart(2, "0");
    expect(text).not.toMatch(new RegExp(`:\\d{2}:${seconds}`));
    expect(text).toBe(
      new Date(iso).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" }),
    );
  });
});
