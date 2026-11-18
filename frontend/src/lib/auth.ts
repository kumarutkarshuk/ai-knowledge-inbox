const SESSION_KEY = "session";

interface Session {
  token: string;
  expiresAt: string;
}

function readSession(): Session | null {
  try {
    const session = JSON.parse(localStorage.getItem(SESSION_KEY) ?? "null") as Session | null;
    return typeof session?.token === "string" && typeof session.expiresAt === "string"
      ? session
      : null;
  } catch {
    return null;
  }
}

export function getToken(): string | null {
  const session = readSession();
  if (session && Date.parse(session.expiresAt) > Date.now()) return session.token;
  clearToken();
  return null;
}

export function setToken(token: string, expiresAt: string): void {
  localStorage.setItem(SESSION_KEY, JSON.stringify({ token, expiresAt }));
}

export function clearToken(): void {
  localStorage.removeItem(SESSION_KEY);
}
