import { vi } from "vitest";
import { EMBEDDING_DIMS, JINA_EMBEDDINGS_URL, JINA_READER_URL } from "../constants.js";

export type FakePage = { title?: string; content: string } | { status: number } | Error;

export function fakeVector(seed: number): number[] {
  const values = new Array<number>(EMBEDDING_DIMS).fill(0);
  values[seed % EMBEDDING_DIMS] = 1;
  return values;
}

export function stubJina(pages: Record<string, FakePage> = {}) {
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url === JINA_EMBEDDINGS_URL) {
      const { input: texts } = JSON.parse(String(init?.body)) as { input: string[] };
      const data = texts.map((_, index) => ({ index, embedding: fakeVector(index) }));
      return Response.json({ data });
    }
    if (url.startsWith(JINA_READER_URL)) {
      const page = pages[url.slice(JINA_READER_URL.length)];
      if (!page) return new Response("not found", { status: 404 });
      if (page instanceof Error) throw page;
      if ("status" in page) return new Response("error", { status: page.status });
      return Response.json({ code: 200, data: { title: page.title ?? "", content: page.content } });
    }
    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
