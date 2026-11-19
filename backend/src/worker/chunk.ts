import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { CHUNK_OVERLAP, CHUNK_SIZE } from "../constants.js";

const splitter = new RecursiveCharacterTextSplitter({
  chunkSize: CHUNK_SIZE,
  chunkOverlap: CHUNK_OVERLAP,
});

export function chunkText(text: string): Promise<string[]> {
  return splitter.splitText(text);
}
