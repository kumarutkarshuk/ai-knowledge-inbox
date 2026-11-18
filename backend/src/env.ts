import { z } from "zod";
import { DEFAULT_PORT, TOKEN_SECRET_MIN_CHARS } from "./constants.js";

const required = z.string().trim().min(1);

const envSchema = z.object({
  PORT: z.coerce.number().int().min(0).max(65535).default(DEFAULT_PORT),
  FRONTEND_ORIGIN: z.url().transform((value) => new URL(value).origin),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/, error: "must be a postgres:// URL" }),
  GROQ_API_KEY: required,
  JINA_API_KEY: required,
  APP_PASSWORD: z.string().refine((value) => value.trim().length > 0),
  TOKEN_SECRET: z.string().trim().min(TOKEN_SECRET_MIN_CHARS),
});

export type Env = z.infer<typeof envSchema>;

export class EnvError extends Error {}

export function parseEnv(source: NodeJS.ProcessEnv): Env {
  const result = envSchema.safeParse(source);
  if (result.success) return result.data;
  const lines = result.error.issues.map((issue) => {
    const name = issue.path.join(".");
    return source[name]?.trim() ? `- ${name}: ${issue.message}` : `- ${name}: missing`;
  });
  throw new EnvError(`Invalid environment variables:\n${lines.join("\n")}`);
}
