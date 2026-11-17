export const validEnv = {
  PORT: '4000',
  FRONTEND_ORIGIN: 'http://localhost:5173',
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
  GROQ_API_KEY: 'groq-key',
  JINA_API_KEY: 'jina-key',
  APP_PASSWORD: 'password',
  TOKEN_SECRET: 'token-secret-token-secret-token-secret',
};

export type EnvKey = keyof typeof validEnv;

export function envWithout(key: EnvKey): Record<string, string> {
  const env: Record<string, string> = { ...validEnv };
  delete env[key];
  return env;
}
