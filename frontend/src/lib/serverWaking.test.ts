import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SLOW_REQUEST_MS } from "@/constants";
import { isServerWaking, trackSlow } from "@/lib/serverWaking";

function deferred() {
  let resolve!: (value: string) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<string>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("trackSlow", () => {
  it("stays while any slow request is still waiting", async () => {
    const first = deferred();
    const second = deferred();
    void trackSlow(first.promise);
    trackSlow(second.promise).catch(() => undefined);
    expect(isServerWaking()).toBe(false);
    await vi.advanceTimersByTimeAsync(SLOW_REQUEST_MS);
    expect(isServerWaking()).toBe(true);

    first.resolve("ok");
    await vi.advanceTimersByTimeAsync(0);
    expect(isServerWaking()).toBe(true);

    second.reject(new TypeError("Failed to fetch"));
    await vi.advanceTimersByTimeAsync(0);
    expect(isServerWaking()).toBe(false);
  });

  it("hides after an aborted slow request", async () => {
    const controller = new AbortController();
    const request = new Promise<string>((_, reject) =>
      controller.signal.addEventListener("abort", () => reject(controller.signal.reason)),
    );
    const tracked = trackSlow(request).catch(() => "aborted");
    await vi.advanceTimersByTimeAsync(SLOW_REQUEST_MS);
    expect(isServerWaking()).toBe(true);

    controller.abort();
    expect(await tracked).toBe("aborted");
    expect(isServerWaking()).toBe(false);
  });

  it("returns the value of a fast request without counting it", async () => {
    await expect(trackSlow(Promise.resolve("fast"))).resolves.toBe("fast");
    await vi.advanceTimersByTimeAsync(SLOW_REQUEST_MS * 2);
    expect(isServerWaking()).toBe(false);
  });
});
