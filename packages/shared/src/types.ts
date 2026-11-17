import type { ERROR_CODES } from './constants.js';

export type ItemType = 'NOTE' | 'URL';

export type ItemStatus = 'SUBMITTED' | 'PROCESSING' | 'FAILED' | 'READY';

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

export interface ItemsResponse {
  items: Item[];
}

export interface IngestNoteRequest {
  type: 'NOTE';
  content: string;
  title?: string;
}

export interface IngestUrlRequest {
  type: 'URL';
  url: string;
}

export type IngestRequest = IngestNoteRequest | IngestUrlRequest;

export interface LoginRequest {
  password: string;
}

export interface LoginResponse {
  token: string;
  expiresAt: string;
}

export interface QueryRequest {
  query: string;
}

export interface Citation {
  n: number;
  itemId: string;
  type: ItemType;
  title: string | null;
  sourceUrl: string | null;
  snippet: string;
  similarity: number;
}

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export interface ApiError {
  error: {
    code: ErrorCode;
    message: string;
  };
}

export interface SseEventMap {
  citations: Citation[];
  token: { text: string };
  done: Record<string, never>;
  error: { message: string };
}

export type SseEventName = keyof SseEventMap;

export type SseEvent = {
  [K in SseEventName]: { event: K; data: SseEventMap[K] };
}[SseEventName];
