import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SERVER_WAKING_HINT, SLOW_REQUEST_MS } from "@/constants";
import { loginRedirect } from "@/lib/apiClient";
import { setToken } from "@/lib/auth";
import { routes } from "@/routes";

const fetchMock = vi.fn<typeof fetch>();

function deferred() {
  let resolve!: (res: Response) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<Response>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status });
}

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<RouterProvider router={router} />);
  return router;
}

async function advance(ms: number) {
  await act(() => vi.advanceTimersByTimeAsync(ms));
}

function hint() {
  return screen.queryByText(SERVER_WAKING_HINT);
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(loginRedirect, "go").mockImplementation(() => {});
});

afterEach(() => {
  localStorage.clear();
  fetchMock.mockReset();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("server waking up hint", () => {
  it("shows on login only after 5s and hides when the server answers", async () => {
    const login = deferred();
    fetchMock.mockReturnValue(login.promise);
    const router = renderAt("/login");
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.type(screen.getByLabelText("Password"), "secret");
    await user.click(screen.getByRole("button", { name: "Login" }));

    await advance(SLOW_REQUEST_MS - 1000);
    expect(hint()).not.toBeInTheDocument();
    await advance(1000);
    expect(screen.getByRole("status")).toHaveTextContent(SERVER_WAKING_HINT);

    login.resolve(jsonResponse(200, { token: "tok", expiresAt: "2099-11-25T00:00:00.000Z" }));
    expect(
      await screen.findByRole("heading", { name: "What do you want to know?" }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/");
    expect(hint()).not.toBeInTheDocument();
  });

  it("hides when a slow request fails", async () => {
    const login = deferred();
    fetchMock.mockReturnValue(login.promise);
    renderAt("/login");
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.type(screen.getByLabelText("Password"), "secret");
    await user.click(screen.getByRole("button", { name: "Login" }));
    await advance(SLOW_REQUEST_MS);
    expect(hint()).toBeInTheDocument();

    login.reject(new TypeError("Failed to fetch"));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not reach the server. Try again.",
    );
    expect(hint()).not.toBeInTheDocument();
  });

  it("never shows for a fast request", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { items: [] }));
    setToken("tok", new Date(Date.now() + 60_000).toISOString());
    renderAt("/library");
    expect(await screen.findByText("No items yet. Add a note or a URL above.")).toBeInTheDocument();
    await advance(SLOW_REQUEST_MS * 2);
    expect(hint()).not.toBeInTheDocument();
  });

  it("shows on the library page while GET /items is slow", async () => {
    const items = deferred();
    fetchMock.mockReturnValue(items.promise);
    setToken("tok", new Date(Date.now() + 60_000).toISOString());
    renderAt("/library");
    expect(screen.getByText("Loading...")).toBeInTheDocument();
    await advance(SLOW_REQUEST_MS);
    expect(hint()).toBeInTheDocument();

    items.resolve(jsonResponse(200, { items: [] }));
    expect(await screen.findByText("No items yet. Add a note or a URL above.")).toBeInTheDocument();
    expect(hint()).not.toBeInTheDocument();
  });

  it("does not show while a long answer streams after the headers arrived", async () => {
    setToken("tok", new Date(Date.now() + 60_000).toISOString());
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("event: citations\ndata: []\n\n"));
      },
    });
    fetchMock.mockResolvedValue(
      new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } }),
    );
    renderAt("/");
    await userEvent
      .setup({ advanceTimers: vi.advanceTimersByTime })
      .type(screen.getByRole("textbox", { name: "Question" }), "slow answer{Enter}");
    expect(await screen.findByText("Writing the answer...")).toBeInTheDocument();
    await advance(SLOW_REQUEST_MS * 3);
    expect(hint()).not.toBeInTheDocument();
  });
});
