import { describe, expect, it } from "vitest";
import { readApiUrl } from "@/config";

describe("readApiUrl", () => {
  it("returns the url without a trailing slash", () => {
    expect(readApiUrl("https://api.example.com/")).toBe("https://api.example.com");
    expect(readApiUrl("http://localhost:3000")).toBe("http://localhost:3000");
  });

  it("throws a clear error when missing or blank", () => {
    expect(() => readApiUrl(undefined)).toThrow("VITE_API_URL is not set");
    expect(() => readApiUrl("  ")).toThrow("VITE_API_URL is not set");
  });
});
