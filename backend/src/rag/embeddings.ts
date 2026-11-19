import {
  EMBED_BATCH_SIZE,
  EMBEDDING_DIMS,
  JINA_EMBEDDING_MODEL,
  JINA_EMBEDDINGS_URL,
} from "../constants.js";
import { withTimeout } from "./timeout.js";

type EmbeddingTask = "retrieval.passage" | "retrieval.query";

interface JinaEmbeddingResponse {
  data?: { index: number; embedding: number[] }[];
}

async function embed(
  texts: string[],
  task: EmbeddingTask,
  apiKey: string,
  signal?: AbortSignal,
): Promise<number[][]> {
  const res = await fetch(JINA_EMBEDDINGS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: JINA_EMBEDDING_MODEL,
      task,
      dimensions: EMBEDDING_DIMS,
      input: texts,
    }),
    signal: withTimeout(signal),
  });
  if (!res.ok) throw new Error(`Jina embeddings failed with HTTP ${res.status}`);
  const body = (await res.json()) as JinaEmbeddingResponse;
  const data = [...(body.data ?? [])].sort((a, b) => a.index - b.index);
  const vectors = data.map((d) => d.embedding);
  if (
    vectors.length !== texts.length ||
    vectors.some((v) => !Array.isArray(v) || v.length !== EMBEDDING_DIMS)
  ) {
    throw new Error("Jina embeddings returned an unexpected response");
  }
  return vectors;
}

export async function embedPassages(
  texts: string[],
  apiKey: string,
  signal?: AbortSignal,
): Promise<number[][]> {
  const vectors: number[][] = [];
  for (let i = 0; i < texts.length; i += EMBED_BATCH_SIZE) {
    vectors.push(
      ...(await embed(texts.slice(i, i + EMBED_BATCH_SIZE), "retrieval.passage", apiKey, signal)),
    );
  }
  return vectors;
}

export async function embedQuery(
  text: string,
  apiKey: string,
  signal?: AbortSignal,
): Promise<number[]> {
  const [vector] = await embed([text], "retrieval.query", apiKey, signal);
  return vector as number[];
}
