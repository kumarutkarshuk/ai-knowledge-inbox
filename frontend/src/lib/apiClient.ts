import { API_URL } from "@/config";
import { clearToken, getToken } from "@/lib/auth";
import { trackSlow } from "@/lib/serverWaking";
import type { ErrorResponse } from "@/types/api";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const loginRedirect = {
  go: () => window.location.assign("/login"),
};

function isErrorResponse(body: unknown): body is ErrorResponse {
  if (typeof body !== "object" || body === null || !("error" in body)) return false;
  const { error } = body as { error: unknown };
  return (
    typeof error === "object" &&
    error !== null &&
    typeof (error as ErrorResponse["error"]).code === "string" &&
    typeof (error as ErrorResponse["error"]).message === "string"
  );
}

async function toApiError(res: Response): Promise<ApiError> {
  const body: unknown = await res.json().catch(() => null);
  if (isErrorResponse(body)) return new ApiError(res.status, body.error.code, body.error.message);
  return new ApiError(res.status, `HTTP_${res.status}`, "Request failed");
}

export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  const res = await trackSlow(fetch(`${API_URL}${path}`, { ...init, headers }));
  if (res.ok) return res;
  if (res.status === 401 && token) {
    clearToken();
    loginRedirect.go();
  }
  throw await toApiError(res);
}

export async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await apiFetch(path, init);
  if (res.status === 204) return undefined as T;
  try {
    return (await res.json()) as T;
  } catch {
    throw new ApiError(res.status, "INVALID_RESPONSE", "Invalid response from the server");
  }
}
