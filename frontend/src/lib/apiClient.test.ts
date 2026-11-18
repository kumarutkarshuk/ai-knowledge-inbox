import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiFetch, apiJson, loginRedirect } from "@/lib/apiClient";
import { getToken, setToken } from "@/lib/auth";

const future = new Date(Date.now() + 60_000).toISOString();

const fetchMock = vi.fn<typeof fetch>();

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(loginRedirect, "go").mockImplementation(() => {});
});

afterEach(() => {
  localStorage.clear();
  fetchMock.mockReset();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function sentHeaders() {
  const init = fetchMock.mock.calls[0]?.[1];
  return new Headers(init?.headers);
}

describe("apiFetch", () => {
  it("calls VITE_API_URL with the Bearer token", async () => {
    setToken("abc", future);
    fetchMock.mockResolvedValue(jsonResponse(200, { items: [] }));
    await apiFetch("/items");
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://localhost:3000/items");
    expect(sentHeaders().get("Authorization")).toBe("Bearer abc");
  });

  it("sends no Authorization header without a token", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, {}));
    await apiFetch("/login", { method: "POST", body: "{}" });
    expect(sentHeaders().has("Authorization")).toBe(false);
    expect(sentHeaders().get("Content-Type")).toBe("application/json");
  });

  it("throws an ApiError with the server error shape", async () => {
    setToken("abc", future);
    fetchMock.mockResolvedValue(
      jsonResponse(409, { error: { code: "ALREADY_EXISTS", message: "Already saved" } }),
    );
    const err = await apiFetch("/ingest").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 409, code: "ALREADY_EXISTS", message: "Already saved" });
  });

  it("falls back to a generic error when the body is not the error shape", async () => {
    fetchMock.mockResolvedValue(new Response("Bad gateway", { status: 502 }));
    const err = await apiFetch("/items").catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 502, code: "HTTP_502", message: "Request failed" });
  });

  it("on 401 clears the token and redirects to /login", async () => {
    setToken("expired", future);
    fetchMock.mockResolvedValue(
      jsonResponse(401, { error: { code: "UNAUTHORIZED", message: "Login required" } }),
    );
    await expect(apiFetch("/items")).rejects.toMatchObject({ status: 401 });
    expect(getToken()).toBeNull();
    expect(loginRedirect.go).toHaveBeenCalledOnce();
  });

  it("does not redirect on a 401 for a request sent without a token (wrong password)", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(401, { error: { code: "UNAUTHORIZED", message: "Wrong password" } }),
    );
    await expect(apiFetch("/login", { method: "POST" })).rejects.toMatchObject({ status: 401 });
    expect(loginRedirect.go).not.toHaveBeenCalled();
  });
});

describe("apiJson", () => {
  it("returns the parsed body", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { status: "ok" }));
    await expect(apiJson("/health")).resolves.toEqual({ status: "ok" });
  });

  it("throws an ApiError for a 2xx body that is not JSON", async () => {
    fetchMock.mockResolvedValue(new Response("<html>", { status: 200 }));
    await expect(apiJson("/health")).rejects.toMatchObject({
      status: 200,
      code: "INVALID_RESPONSE",
    });
  });

  it("returns undefined for 204", async () => {
    setToken("abc", future);
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await expect(apiJson("/items/1", { method: "DELETE" })).resolves.toBeUndefined();
  });
});
