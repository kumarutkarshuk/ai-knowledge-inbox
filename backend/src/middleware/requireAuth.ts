import type { RequestHandler } from "express";
import { verifyToken } from "../auth.js";
import { HttpError } from "../errors.js";

export function requireAuth(secret: string): RequestHandler {
  return (req, _res, next) => {
    const [scheme, token] = req.get("Authorization")?.split(" ") ?? [];
    if (scheme?.toLowerCase() !== "bearer" || !token || !verifyToken(token, secret)) {
      next(new HttpError(401, "UNAUTHORIZED", "Login required"));
      return;
    }
    next();
  };
}
