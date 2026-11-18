import cors from "cors";
import express from "express";
import { JSON_BODY_LIMIT } from "./constants.js";
import type { Env } from "./env.js";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";

export function createApp(env: Pick<Env, "FRONTEND_ORIGIN">) {
  const app = express();
  app.disable("x-powered-by");
  app.use(cors({ origin: env.FRONTEND_ORIGIN }));
  app.use(express.json({ limit: JSON_BODY_LIMIT }));

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
