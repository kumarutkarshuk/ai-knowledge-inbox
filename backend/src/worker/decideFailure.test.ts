import { describe, expect, it } from "vitest";
import { ERROR_MESSAGE_MAX_CHARS } from "../constants.js";
import { decideFailure } from "./jobs.js";

describe("decideFailure", () => {
  it.each([
    [0, 1, "SUBMITTED"],
    [1, 2, "SUBMITTED"],
    [2, 3, "SUBMITTED"],
    [3, 4, "FAILED"],
    [7, 8, "FAILED"],
  ])("retry_count %i -> %i, %s", (current, next, status) => {
    expect(decideFailure(current, new Error("boom"))).toEqual({
      retryCount: next,
      status,
      errorMessage: "boom",
    });
  });

  it("cuts a long error message short", () => {
    const { errorMessage } = decideFailure(0, new Error("x".repeat(5000)));
    expect(errorMessage).toHaveLength(ERROR_MESSAGE_MAX_CHARS);
  });

  it("handles non-Error values and blank messages", () => {
    expect(decideFailure(0, "plain").errorMessage).toBe("plain");
    expect(decideFailure(0, new Error("  ")).errorMessage).toBe("Unknown error");
  });

  it("adds the cause of the error", () => {
    const err = new TypeError("fetch failed", { cause: new Error("getaddrinfo ENOTFOUND x") });
    expect(decideFailure(0, err).errorMessage).toBe("fetch failed: getaddrinfo ENOTFOUND x");
  });
});
