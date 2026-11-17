import { describe, expect, it } from 'vitest';
import * as shared from '../src/index.js';

describe('shared constants match SPEC sections 6 and 8', () => {
  it.each([
    ['NOTE_MAX_CHARS', 50_000],
    ['URL_CONTENT_MAX_CHARS', 200_000],
    ['NOTE_TITLE_FALLBACK_CHARS', 60],
    ['NOTE_TITLE_MAX_CHARS', 200],
    ['NOTE_PREVIEW_CHARS', 200],
    ['SNIPPET_MAX_CHARS', 300],
    ['QUERY_MAX_CHARS', 1_000],
    ['CHUNK_SIZE', 1000],
    ['CHUNK_OVERLAP', 200],
    ['TOP_K', 5],
    ['MIN_SIMILARITY', 0.5],
    ['CRON_SCHEDULE', '* * * * *'],
    ['JOBS_PER_RUN', 3],
    ['MAX_RETRIES', 3],
    ['STUCK_AFTER_MINUTES', 10],
    ['TOKEN_TTL', '7d'],
    ['ITEMS_POLL_MS', 5000],
    ['NOT_FOUND_ANSWER', 'Not found in your saved items.'],
  ] as const)('%s is %s', (name, value) => {
    expect(shared[name]).toBe(value);
  });

  it('keeps chunk overlap smaller than chunk size', () => {
    expect(shared.CHUNK_OVERLAP).toBeLessThan(shared.CHUNK_SIZE);
  });
});

describe('error codes', () => {
  it('maps every code to itself', () => {
    for (const [key, value] of Object.entries(shared.ERROR_CODES)) {
      expect(value).toBe(key);
    }
  });

  it('includes the codes named in the SPEC', () => {
    expect(Object.values(shared.ERROR_CODES)).toEqual(
      expect.arrayContaining(['UNAUTHORIZED', 'ALREADY_EXISTS', 'ITEM_BUSY']),
    );
  });
});
