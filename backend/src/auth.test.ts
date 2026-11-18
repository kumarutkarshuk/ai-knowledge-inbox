import jwt from "jsonwebtoken";
import { afterEach, describe, expect, it, vi } from "vitest";
import { passwordMatches, signToken, verifyToken } from "./auth.js";

const secret = "test-token-secret-that-is-32-chars";
const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

afterEach(() => {
  vi.useRealTimers();
});

describe("signToken", () => {
  it("signs an HS256 token for the owner with a 7 day expiry", () => {
    vi.useFakeTimers({ now: new Date("2026-11-18T00:00:00.000Z") });
    const { token, expiresAt } = signToken(secret);
    expect(expiresAt).toBe(new Date(Date.now() + sevenDaysMs).toISOString());
    const decoded = jwt.decode(token, { complete: true });
    expect(decoded?.header.alg).toBe("HS256");
    expect(decoded?.payload).toMatchObject({ sub: "owner" });
  });
});

describe("verifyToken", () => {
  it("accepts a token it signed", () => {
    expect(verifyToken(signToken(secret).token, secret)).toBe(true);
  });

  it("accepts a token just before expiry and rejects it just after", () => {
    vi.useFakeTimers({ now: new Date("2026-11-18T00:00:00.000Z") });
    const { token } = signToken(secret);
    vi.setSystemTime(Date.now() + sevenDaysMs - 1000);
    expect(verifyToken(token, secret)).toBe(true);
    vi.setSystemTime(Date.now() + 2000);
    expect(verifyToken(token, secret)).toBe(false);
  });

  it("rejects a token signed with another secret", () => {
    const { token } = signToken("another-secret-that-is-also-32-chars");
    expect(verifyToken(token, secret)).toBe(false);
  });

  it("rejects a tampered payload", () => {
    const [header, , signature] = signToken(secret).token.split(".");
    const payload = Buffer.from(JSON.stringify({ sub: "admin", exp: 9999999999 })).toString(
      "base64url",
    );
    expect(verifyToken(`${header}.${payload}.${signature}`, secret)).toBe(false);
  });

  it("rejects an unsigned (alg none) token", () => {
    const token = jwt.sign({ sub: "owner" }, "", { algorithm: "none" });
    expect(verifyToken(token, secret)).toBe(false);
  });

  it("rejects a token with another algorithm", () => {
    const token = jwt.sign({ sub: "owner" }, secret, { algorithm: "HS512", expiresIn: "1h" });
    expect(verifyToken(token, secret)).toBe(false);
  });

  it("rejects a token for another subject", () => {
    const token = jwt.sign({ sub: "someone" }, secret, { algorithm: "HS256", expiresIn: "1h" });
    expect(verifyToken(token, secret)).toBe(false);
  });

  it("rejects a token without an expiry", () => {
    const token = jwt.sign({ sub: "owner" }, secret, { algorithm: "HS256" });
    expect(verifyToken(token, secret)).toBe(false);
  });

  it("rejects garbage", () => {
    expect(verifyToken("", secret)).toBe(false);
    expect(verifyToken("not.a.jwt", secret)).toBe(false);
  });
});

describe("passwordMatches", () => {
  it("matches only the exact password", () => {
    expect(passwordMatches("password", "password")).toBe(true);
    expect(passwordMatches("Password", "password")).toBe(false);
    expect(passwordMatches("password ", "password")).toBe(false);
    expect(passwordMatches("", "password")).toBe(false);
    expect(passwordMatches("a much longer password than the real one", "password")).toBe(false);
  });
});
