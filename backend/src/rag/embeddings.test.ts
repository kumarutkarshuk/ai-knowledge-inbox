import { afterEach, describe, expect, it, vi } from "vitest";
import { EMBEDDING_DIMS } from "../constants.js";
import { stubJina } from "../test/fakeJina.js";
import { embedPassages, embedQuery } from "./embeddings.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

function sentBodies(fetchMock: ReturnType<typeof stubJina>) {
  return fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init?.body)));
}

describe("embeddings", () => {
  it("embeds passages in batches of 100 with the passage task", async () => {
    const fetchMock = stubJina();
    const texts = Array.from({ length: 250 }, (_, i) => `t${i}`);
    const vectors = await embedPassages(texts, "key");
    expect(vectors).toHaveLength(250);
    const bodies = sentBodies(fetchMock);
    expect(bodies.map((b) => b.input.length)).toEqual([100, 100, 50]);
    expect(bodies[0]).toMatchObject({
      model: "jina-embeddings-v3",
      task: "retrieval.passage",
      dimensions: EMBEDDING_DIMS,
    });
    expect(bodies[2].input[0]).toBe("t200");
  });

  it("embeds a query with the query task", async () => {
    const fetchMock = stubJina();
    expect(await embedQuery("hi", "key")).toHaveLength(EMBEDDING_DIMS);
    expect(sentBodies(fetchMock)[0]).toMatchObject({ task: "retrieval.query", input: ["hi"] });
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.headers).toMatchObject({ Authorization: "Bearer key" });
  });

  it("returns vectors in input order", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          data: [
            { index: 1, embedding: new Array(EMBEDDING_DIMS).fill(2) },
            { index: 0, embedding: new Array(EMBEDDING_DIMS).fill(1) },
          ],
        }),
      ),
    );
    const [a, b] = await embedPassages(["a", "b"], "key");
    expect(a?.[0]).toBe(1);
    expect(b?.[0]).toBe(2);
  });

  it("throws on a non-2xx response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("no", { status: 401 })),
    );
    await expect(embedQuery("hi", "key")).rejects.toThrow("HTTP 401");
  });

  it("throws on vectors with the wrong size", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ data: [{ index: 0, embedding: [1, 2, 3] }] })),
    );
    await expect(embedQuery("hi", "key")).rejects.toThrow(/unexpected response/);
  });

  it("makes no call for an empty passage list", async () => {
    const fetchMock = stubJina();
    expect(await embedPassages([], "key")).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
