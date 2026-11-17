function readApiUrl(): string {
  const value = import.meta.env.VITE_API_URL?.trim();
  if (!value) throw new Error('VITE_API_URL is not set. Copy apps/web/.env.example to .env.');
  return value.replace(/\/+$/, '');
}

export const API_URL = readApiUrl();
