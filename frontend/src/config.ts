export function readApiUrl(value: string | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed) throw new Error("VITE_API_URL is not set");
  return trimmed.replace(/\/+$/, "");
}

export const API_URL = readApiUrl(import.meta.env.VITE_API_URL);
