import { describe, expect, it } from "vitest";
import { EnvError, parseEnv } from "./env.js";
import { validEnv } from "./test/fixtures.js";

function messageFor(source: NodeJS.ProcessEnv) {
  try {
    parseEnv(source);
  } catch (err) {
    expect(err).toBeInstanceOf(EnvError);
    return (err as EnvError).message;
  }
  throw new Error("expected parseEnv to throw");
}

describe("parseEnv", () => {
  it("parses a valid env and coerces PORT", () => {
    const env = parseEnv({ ...validEnv, PORT: "4000" });
    expect(env.PORT).toBe(4000);
    expect(env.FRONTEND_ORIGIN).toBe(validEnv.FRONTEND_ORIGIN);
  });

  it("defaults PORT to 3000", () => {
    const { PORT: _port, ...rest } = validEnv;
    expect(parseEnv(rest).PORT).toBe(3000);
  });

  it("names a missing var", () => {
    const { TOKEN_SECRET: _secret, ...rest } = validEnv;
    expect(messageFor(rest)).toContain("- TOKEN_SECRET: missing");
  });

  it("treats an empty or blank var as missing", () => {
    expect(messageFor({ ...validEnv, APP_PASSWORD: "" })).toContain("- APP_PASSWORD: missing");
    expect(messageFor({ ...validEnv, APP_PASSWORD: "   " })).toContain("- APP_PASSWORD: missing");
  });

  it("lists every missing var at once", () => {
    const message = messageFor({});
    for (const name of Object.keys(validEnv).filter((k) => k !== "PORT")) {
      expect(message).toContain(name);
    }
  });

  it("rejects an invalid FRONTEND_ORIGIN", () => {
    expect(messageFor({ ...validEnv, FRONTEND_ORIGIN: "not a url" })).toContain("FRONTEND_ORIGIN");
  });

  it("accepts postgres and postgresql DATABASE_URL schemes", () => {
    expect(
      parseEnv({ ...validEnv, DATABASE_URL: "postgres://u:p@localhost:5432/db" }).DATABASE_URL,
    ).toBe("postgres://u:p@localhost:5432/db");
    expect(parseEnv(validEnv).DATABASE_URL).toBe(validEnv.DATABASE_URL);
  });

  it("rejects a non-postgres DATABASE_URL without printing its value", () => {
    const message = messageFor({ ...validEnv, DATABASE_URL: "https://secret-host.supabase.co" });
    expect(message).toContain("- DATABASE_URL: must be a postgres:// URL");
    expect(message).not.toContain("secret-host");
  });

  it("no longer needs the Supabase REST vars", () => {
    expect(() => parseEnv(validEnv)).not.toThrow();
    expect(parseEnv(validEnv)).not.toHaveProperty("SUPABASE_SERVICE_ROLE_KEY");
  });

  it("keeps only the origin of FRONTEND_ORIGIN", () => {
    const env = parseEnv({ ...validEnv, FRONTEND_ORIGIN: "https://App.example.com/some/path/" });
    expect(env.FRONTEND_ORIGIN).toBe("https://app.example.com");
  });

  it("rejects a short APP_PASSWORD", () => {
    expect(messageFor({ ...validEnv, APP_PASSWORD: "short pass" })).toContain(
      "- APP_PASSWORD: must be at least 12 chars",
    );
  });

  it("keeps APP_PASSWORD exactly as set, without trimming", () => {
    expect(parseEnv(validEnv).APP_PASSWORD).toBe(validEnv.APP_PASSWORD);
  });

  it("rejects a short TOKEN_SECRET", () => {
    expect(messageFor({ ...validEnv, TOKEN_SECRET: "short" })).toContain("TOKEN_SECRET");
  });

  it("rejects a non-numeric PORT", () => {
    expect(messageFor({ ...validEnv, PORT: "abc" })).toContain("PORT");
  });
});
