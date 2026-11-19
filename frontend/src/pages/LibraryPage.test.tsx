import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loginRedirect } from "@/lib/apiClient";
import { getToken, setToken } from "@/lib/auth";
import { routes } from "@/routes";
import { formatDateTime } from "@/lib/format";
import type { Item } from "@/types/api";

const future = new Date(Date.now() + 60_000).toISOString();
const fetchMock = vi.fn<typeof fetch>();

function jsonResponse(status: number, body?: unknown) {
  return new Response(body === undefined ? null : JSON.stringify(body), { status });
}

function item(overrides: Partial<Item> = {}): Item {
  return {
    id: crypto.randomUUID(),
    type: "NOTE",
    title: "My note",
    sourceUrl: null,
    preview: "note text",
    status: "READY",
    errorMessage: null,
    createdAt: "2026-11-18T10:00:00.000Z",
    ...overrides,
  };
}

function itemsResponse(items: Item[]) {
  return jsonResponse(200, { items });
}

function calls(method: string, path: string) {
  return fetchMock.mock.calls.filter(
    ([url, init]) => url === `http://localhost:3000${path}` && (init?.method ?? "GET") === method,
  );
}

function renderLibrary() {
  const router = createMemoryRouter(routes, { initialEntries: ["/library"] });
  render(<RouterProvider router={router} />);
  return router;
}

beforeEach(() => {
  setToken("tok", future);
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

describe("LibraryPage list", () => {
  it("shows the empty state", async () => {
    fetchMock.mockResolvedValue(itemsResponse([]));
    renderLibrary();
    expect(await screen.findByText("No items yet. Add a note or a URL above.")).toBeInTheDocument();
  });

  it("shows each item with icon, title, link or preview, status, error and time", async () => {
    fetchMock.mockResolvedValue(
      itemsResponse([
        item({ title: "Note A", preview: "note preview" }),
        item({
          type: "URL",
          title: "Page B",
          sourceUrl: "https://example.com/b",
          preview: null,
          status: "FAILED",
          errorMessage: "No text content found",
        }),
      ]),
    );
    renderLibrary();
    const [note, url] = within(await screen.findByRole("list", { name: "Items" })).getAllByRole(
      "listitem",
    );
    const n = within(note as HTMLElement);
    expect(n.getByLabelText("Note")).toBeInTheDocument();
    expect(n.getByText("Note A")).toBeInTheDocument();
    expect(n.getByText("note preview")).toBeInTheDocument();
    expect(n.getByText("READY")).toBeInTheDocument();
    expect(n.getByText(formatDateTime("2026-11-18T10:00:00.000Z"))).toBeInTheDocument();

    const u = within(url as HTMLElement);
    expect(u.getByLabelText("URL")).toBeInTheDocument();
    expect(u.getByRole("link", { name: "https://example.com/b" })).toHaveAttribute(
      "href",
      "https://example.com/b",
    );
    expect(u.getByText("FAILED")).toBeInTheDocument();
    expect(u.getByText("No text content found")).toBeInTheDocument();
  });

  it("shows a delete button only for READY and FAILED items", async () => {
    fetchMock.mockResolvedValue(
      itemsResponse([
        item({ title: "ready", status: "READY" }),
        item({ title: "failed", status: "FAILED" }),
        item({ title: "submitted", status: "SUBMITTED" }),
        item({ title: "processing", status: "PROCESSING" }),
      ]),
    );
    renderLibrary();
    await screen.findByText("ready");
    expect(screen.getByRole("button", { name: "Delete ready" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete failed" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete submitted" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete processing" })).not.toBeInTheDocument();
  });

  it("shows an error when the list cannot be loaded", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    renderLibrary();
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not reach the server");
  });
});

describe("LibraryPage delete", () => {
  it("does nothing when the confirm dialog is cancelled", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const ready = item({ title: "keep me" });
    fetchMock.mockResolvedValue(itemsResponse([ready]));
    renderLibrary();
    await userEvent.click(await screen.findByRole("button", { name: "Delete keep me" }));
    expect(confirm).toHaveBeenCalledWith('Delete "keep me"?');
    expect(calls("DELETE", `/items/${ready.id}`)).toHaveLength(0);
  });

  it("deletes after confirm and reloads the list", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const ready = item({ title: "remove me" });
    fetchMock
      .mockResolvedValueOnce(itemsResponse([ready]))
      .mockResolvedValueOnce(jsonResponse(204))
      .mockResolvedValueOnce(itemsResponse([]));
    renderLibrary();
    await userEvent.click(await screen.findByRole("button", { name: "Delete remove me" }));
    expect(await screen.findByText("No items yet. Add a note or a URL above.")).toBeInTheDocument();
    expect(calls("DELETE", `/items/${ready.id}`)).toHaveLength(1);
  });

  it("shows the server message when delete gets 409 ITEM_BUSY", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const ready = item({ title: "busy" });
    fetchMock
      .mockResolvedValueOnce(itemsResponse([ready]))
      .mockResolvedValueOnce(
        jsonResponse(409, {
          error: { code: "ITEM_BUSY", message: "Item is still being processed" },
        }),
      )
      .mockResolvedValueOnce(itemsResponse([{ ...ready, status: "PROCESSING" }]));
    renderLibrary();
    await userEvent.click(await screen.findByRole("button", { name: "Delete busy" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Item is still being processed");
  });
});

describe("LibraryPage stale responses", () => {
  it("ignores an older list response that arrives after a newer one", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const ready = item({ title: "old item" });
    let releaseFirst: (res: Response) => void = () => {};
    fetchMock
      .mockReturnValueOnce(new Promise((resolve) => (releaseFirst = resolve)))
      .mockResolvedValueOnce(jsonResponse(201, { item: item({ title: "new item" }) }))
      .mockResolvedValueOnce(itemsResponse([item({ title: "new item" })]));
    renderLibrary();
    const user = userEvent.setup();
    await user.click(screen.getByRole("textbox", { name: "Note" }));
    await user.paste("new note");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("new item")).toBeInTheDocument();

    await act(async () => releaseFirst(itemsResponse([ready])));
    expect(screen.getByText("new item")).toBeInTheDocument();
    expect(screen.queryByText("old item")).not.toBeInTheDocument();
  });
});

describe("LibraryPage add form", () => {
  async function typeNote(content: string, title?: string) {
    const user = userEvent.setup();
    if (title) await user.type(screen.getByLabelText("Title (optional)"), title);
    await user.click(screen.getByRole("textbox", { name: "Note" }));
    await user.paste(content);
    return user;
  }

  it("saves a note, clears the form and reloads the list", async () => {
    fetchMock
      .mockResolvedValueOnce(itemsResponse([]))
      .mockResolvedValueOnce(jsonResponse(201, { item: item({ status: "SUBMITTED" }) }))
      .mockResolvedValue(itemsResponse([item({ title: "Saved title", status: "READY" })]));
    renderLibrary();
    await screen.findByText("No items yet. Add a note or a URL above.");
    const user = await typeNote("hello world", "Saved title");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Saved");
    expect(await screen.findByText("Saved title")).toBeInTheDocument();
    const [post] = calls("POST", "/ingest");
    expect(JSON.parse(post?.[1]?.body as string)).toEqual({
      type: "NOTE",
      content: "hello world",
      title: "Saved title",
    });
    expect(screen.getByRole("textbox", { name: "Note" })).toHaveValue("");
    expect(screen.getByLabelText("Title (optional)")).toHaveValue("");
  });

  it("shows a live char count and blocks a note over 50,000 chars", async () => {
    fetchMock.mockResolvedValue(itemsResponse([]));
    renderLibrary();
    await screen.findByText("No items yet. Add a note or a URL above.");
    expect(screen.getByText("0 / 50,000")).toBeInTheDocument();
    const user = await typeNote("abc");
    expect(screen.getByText("3 / 50,000")).toBeInTheDocument();
    await user.paste("x".repeat(49_998));
    expect(screen.getByText("50,001 / 50,000")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Note" })).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("shows Already saved on 409", async () => {
    fetchMock
      .mockResolvedValueOnce(itemsResponse([]))
      .mockResolvedValueOnce(
        jsonResponse(409, { error: { code: "ALREADY_EXISTS", message: "Already saved" } }),
      );
    renderLibrary();
    await screen.findByText("No items yet. Add a note or a URL above.");
    const user = await typeNote("dup");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Already saved");
    expect(screen.getByRole("textbox", { name: "Note" })).toHaveValue("dup");
  });

  it("sends a URL and shows the 400 validation message", async () => {
    fetchMock.mockResolvedValueOnce(itemsResponse([])).mockResolvedValueOnce(
      jsonResponse(400, {
        error: { code: "VALIDATION_ERROR", message: "URL must start with http:// or https://" },
      }),
    );
    renderLibrary();
    await screen.findByText("No items yet. Add a note or a URL above.");
    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: "URL" }));
    await user.type(screen.getByRole("textbox", { name: "URL" }), "ftp://example.com/file");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "URL must start with http:// or https://",
    );
    const [post] = calls("POST", "/ingest");
    expect(JSON.parse(post?.[1]?.body as string)).toEqual({
      type: "URL",
      url: "ftp://example.com/file",
    });
  });

  it("shows Restored on 200", async () => {
    fetchMock
      .mockResolvedValueOnce(itemsResponse([]))
      .mockResolvedValueOnce(jsonResponse(200, { item: item() }))
      .mockResolvedValue(itemsResponse([item({ title: "back" })]));
    renderLibrary();
    await screen.findByText("No items yet. Add a note or a URL above.");
    const user = await typeNote("old note");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Restored");
    expect(await screen.findByText("back")).toBeInTheDocument();
  });

  it("disables Save while the note or URL is empty", async () => {
    fetchMock.mockResolvedValue(itemsResponse([]));
    renderLibrary();
    await screen.findByText("No items yet. Add a note or a URL above.");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    await typeNote("   ");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });
});

describe("LibraryPage polling", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  it("polls every 5s while an item is SUBMITTED or PROCESSING, then stops", async () => {
    const pending = item({ title: "job", status: "SUBMITTED" });
    fetchMock
      .mockResolvedValueOnce(itemsResponse([pending]))
      .mockResolvedValueOnce(itemsResponse([{ ...pending, status: "PROCESSING" }]))
      .mockResolvedValue(itemsResponse([{ ...pending, status: "READY" }]));
    renderLibrary();
    await screen.findByText("SUBMITTED");
    expect(calls("GET", "/items")).toHaveLength(1);

    await act(() => vi.advanceTimersByTimeAsync(4_900));
    expect(calls("GET", "/items")).toHaveLength(1);
    await act(() => vi.advanceTimersByTimeAsync(100));
    expect(await screen.findByText("PROCESSING")).toBeInTheDocument();

    await act(() => vi.advanceTimersByTimeAsync(5_000));
    expect(await screen.findByText("READY")).toBeInTheDocument();
    expect(calls("GET", "/items")).toHaveLength(3);

    await act(() => vi.advanceTimersByTimeAsync(20_000));
    expect(calls("GET", "/items")).toHaveLength(3);
  });

  it("does not poll when every item is READY or FAILED", async () => {
    fetchMock.mockResolvedValue(
      itemsResponse([item({ status: "READY" }), item({ title: "f", status: "FAILED" })]),
    );
    renderLibrary();
    await screen.findByText("FAILED");
    await act(() => vi.advanceTimersByTimeAsync(20_000));
    expect(calls("GET", "/items")).toHaveLength(1);
  });

  it("stops polling after leaving the page", async () => {
    fetchMock.mockResolvedValue(itemsResponse([item({ status: "PROCESSING" })]));
    const router = renderLibrary();
    await screen.findByText("PROCESSING");
    await act(() => router.navigate("/"));
    await act(() => vi.advanceTimersByTimeAsync(20_000));
    expect(calls("GET", "/items")).toHaveLength(1);
  });
});

describe("LibraryPage auth", () => {
  it("clears a tampered token and goes to /login on 401 from GET /items", async () => {
    localStorage.setItem("session", JSON.stringify({ token: "tampered", expiresAt: future }));
    fetchMock.mockResolvedValue(
      jsonResponse(401, { error: { code: "UNAUTHORIZED", message: "Login required" } }),
    );
    renderLibrary();
    await waitFor(() => expect(loginRedirect.go).toHaveBeenCalledTimes(1));
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get("Authorization")).toBe(
      "Bearer tampered",
    );
    expect(getToken()).toBeNull();
    expect(localStorage.getItem("session")).toBeNull();
  });
});
