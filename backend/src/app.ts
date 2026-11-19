import cors from "cors";
import express from "express";
import type pg from "pg";
import { JSON_BODY_LIMIT, TRUST_PROXY_HOPS } from "./constants.js";
import type { Env } from "./env.js";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";
import { requireAuth } from "./middleware/requireAuth.js";
import { itemsRouter } from "./routes/items.js";
import { loginRouter } from "./routes/login.js";
import { queryRouter } from "./routes/query.js";
import { groqAnswer, type AnswerStream } from "./rag/answer.js";

export type AppEnv = Pick<
  Env,
  "FRONTEND_ORIGIN" | "APP_PASSWORD" | "TOKEN_SECRET" | "GROQ_API_KEY" | "JINA_API_KEY"
>;

export function createApp(
  env: AppEnv,
  pool: pg.Pool,
  answer: AnswerStream = groqAnswer(env.GROQ_API_KEY),
) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", TRUST_PROXY_HOPS);
  app.use(cors({ origin: env.FRONTEND_ORIGIN }));

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });
  app.use(loginRouter(env));

  app.use(requireAuth(env.TOKEN_SECRET));
  app.use(express.json({ limit: JSON_BODY_LIMIT }));
  app.use(itemsRouter(pool));
  app.use(queryRouter(pool, env.JINA_API_KEY, answer));

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
