import { createHash, timingSafeEqual } from "node:crypto";
import jwt from "jsonwebtoken";
import { TOKEN_SUBJECT, TOKEN_TTL } from "./constants.js";
import type { LoginResponse } from "./types/api.js";

const ALGORITHM = "HS256";

function sha256(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

export function passwordMatches(given: string, expected: string): boolean {
  return timingSafeEqual(sha256(given), sha256(expected));
}

export function signToken(secret: string): LoginResponse {
  const token = jwt.sign({}, secret, {
    algorithm: ALGORITHM,
    subject: TOKEN_SUBJECT,
    expiresIn: TOKEN_TTL,
  });
  const { exp } = jwt.decode(token) as jwt.JwtPayload;
  return { token, expiresAt: new Date((exp ?? 0) * 1000).toISOString() };
}

export function verifyToken(token: string, secret: string): boolean {
  try {
    const payload = jwt.verify(token, secret, {
      algorithms: [ALGORITHM],
      subject: TOKEN_SUBJECT,
    });
    return typeof payload === "object" && typeof payload.exp === "number";
  } catch {
    return false;
  }
}
