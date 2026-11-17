export const NOTE_MAX_CHARS = 50_000;
export const NOTE_TITLE_MAX_CHARS = 200;
export const URL_CONTENT_MAX_CHARS = 200_000;
export const NOTE_TITLE_FALLBACK_CHARS = 60;
export const NOTE_PREVIEW_CHARS = 200;
export const QUERY_MAX_CHARS = 1_000;
export const CHUNK_SIZE = 1000;
export const CHUNK_OVERLAP = 200;
export const TOP_K = 5;
export const MIN_SIMILARITY = 0.5;
export const SNIPPET_MAX_CHARS = 300;
export const CRON_SCHEDULE = '* * * * *';
export const JOBS_PER_RUN = 3;
export const MAX_RETRIES = 3;
export const STUCK_AFTER_MINUTES = 10;
export const TOKEN_TTL = '7d';
export const ITEMS_POLL_MS = 5000;
export const NOT_FOUND_ANSWER = 'Not found in your saved items.';

export const ERROR_CODES = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  INVALID_JSON: 'INVALID_JSON',
  UNAUTHORIZED: 'UNAUTHORIZED',
  NOT_FOUND: 'NOT_FOUND',
  ALREADY_EXISTS: 'ALREADY_EXISTS',
  ITEM_BUSY: 'ITEM_BUSY',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;
