import express, { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { passwordMatches, signToken } from "../auth.js";
import { LOGIN_BODY_LIMIT, LOGIN_RATE_LIMIT, LOGIN_RATE_WINDOW_MS } from "../constants.js";
import type { Env } from "../env.js";
import { HttpError } from "../errors.js";

const loginSchema = z.object({ password: z.string().min(1) });

export function loginRouter(env: Pick<Env, "APP_PASSWORD" | "TOKEN_SECRET">) {
  const router = Router();
  const limiter = rateLimit({
    windowMs: LOGIN_RATE_WINDOW_MS,
    limit: LOGIN_RATE_LIMIT,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler: (req, _res, next) => {
      console.warn(`Login rate limited for ${req.ip}`);
      next(new HttpError(429, "TOO_MANY_REQUESTS", "Too many login attempts, try again later"));
    },
  });

  router.post("/login", limiter, express.json({ limit: LOGIN_BODY_LIMIT }), (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, "VALIDATION_ERROR", "Password is required");
    if (!passwordMatches(parsed.data.password, env.APP_PASSWORD)) {
      console.warn(`Wrong login password from ${req.ip}`);
      throw new HttpError(401, "UNAUTHORIZED", "Wrong password");
    }
    res.json(signToken(env.TOKEN_SECRET));
  });

  return router;
}
