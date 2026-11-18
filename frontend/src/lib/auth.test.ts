import { afterEach, describe, expect, it } from "vitest";
import { clearToken, getToken, setToken } from "@/lib/auth";

const future = new Date(Date.now() + 60_000).toISOString();
const past = new Date(Date.now() - 1000).toISOString();

afterEach(() => {
  localStorage.clear();
});

describe("token storage", () => {
  it("returns a stored token that has not expired", () => {
    setToken("tok", future);
    expect(getToken()).toBe("tok");
  });

  it("drops an expired token", () => {
    setToken("tok", past);
    expect(getToken()).toBeNull();
    expect(localStorage.length).toBe(0);
  });

  it("returns null for nothing stored or a corrupt value", () => {
    expect(getToken()).toBeNull();
    localStorage.setItem("session", "{not json");
    expect(getToken()).toBeNull();
    localStorage.setItem("session", JSON.stringify({ token: "tok" }));
    expect(getToken()).toBeNull();
  });

  it("clears the token", () => {
    setToken("tok", future);
    clearToken();
    expect(getToken()).toBeNull();
  });
});
