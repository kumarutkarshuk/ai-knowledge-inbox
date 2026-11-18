export type ItemType = "NOTE" | "URL";

export type ItemStatus = "SUBMITTED" | "PROCESSING" | "FAILED" | "READY";

export interface Item {
  id: string;
  type: ItemType;
  title: string;
  sourceUrl: string | null;
  preview: string | null;
  status: ItemStatus;
  errorMessage: string | null;
  createdAt: string;
}

export interface Citation {
  n: number;
  itemId: string;
  type: ItemType;
  title: string;
  sourceUrl: string | null;
  snippet: string;
  similarity: number;
}

export interface NoteIngestRequest {
  type: "NOTE";
  content: string;
  title?: string;
}

export interface UrlIngestRequest {
  type: "URL";
  url: string;
}

export type IngestRequest = NoteIngestRequest | UrlIngestRequest;

export interface LoginRequest {
  password: string;
}

export interface LoginResponse {
  token: string;
  expiresAt: string;
}

export interface ErrorResponse {
  error: {
    code: string;
    message: string;
  };
}

export type SseEvent =
  | { event: "citations"; data: Citation[] }
  | { event: "token"; data: { text: string } }
  | { event: "done"; data: Record<string, never> }
  | { event: "error"; data: { message: string } };
