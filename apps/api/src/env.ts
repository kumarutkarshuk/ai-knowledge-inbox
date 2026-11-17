import { z } from 'zod';

const required = z.string({ error: 'is required' }).trim().min(1, 'is required');

const httpUrl = z
  .string({ error: 'is required' })
  .trim()
  .pipe(z.url({ protocol: /^https?$/, error: 'must be an http(s) URL' }));

const envSchema = z.object({
  PORT: z.coerce
    .number({ error: 'must be a port number' })
    .int('must be a port number')
    .min(1, 'must be a port number')
    .max(65535, 'must be a port number')
    .default(4000),
  FRONTEND_ORIGIN: httpUrl.transform((value) => new URL(value).origin),
  SUPABASE_URL: httpUrl,
  SUPABASE_SERVICE_ROLE_KEY: required,
  GROQ_API_KEY: required,
  JINA_API_KEY: required,
  APP_PASSWORD: required,
  TOKEN_SECRET: required.pipe(z.string().min(32, 'must be at least 32 characters')),
});

export type Env = z.infer<typeof envSchema>;

export class EnvError extends Error {
  override name = 'EnvError';
}

export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(source);
  if (result.success) return result.data;
  const lines = result.error.issues.map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`);
  throw new EnvError(['Invalid environment variables:', ...lines].join('\n'));
}
