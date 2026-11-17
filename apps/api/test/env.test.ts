import { describe, expect, it } from 'vitest';
import { EnvError, parseEnv } from '../src/env.js';
import { envWithout, validEnv, type EnvKey } from './fixtures.js';

describe('parseEnv', () => {
  it('returns typed env for valid input', () => {
    const env = parseEnv(validEnv);
    expect(env.PORT).toBe(4000);
    expect(env.FRONTEND_ORIGIN).toBe('http://localhost:5173');
  });

  it('defaults PORT to 4000', () => {
    expect(parseEnv(envWithout('PORT')).PORT).toBe(4000);
  });

  it.each(Object.keys(validEnv).filter((k) => k !== 'PORT') as EnvKey[])(
    'fails with a clear message when %s is missing',
    (key) => {
      expect(() => parseEnv(envWithout(key))).toThrow(EnvError);
      expect(() => parseEnv(envWithout(key))).toThrow(new RegExp(`${key}`));
    },
  );

  it('treats an empty value as missing', () => {
    expect(() => parseEnv({ ...validEnv, APP_PASSWORD: '' })).toThrow(/APP_PASSWORD/);
  });

  it('treats a whitespace-only value as missing', () => {
    expect(() => parseEnv({ ...validEnv, TOKEN_SECRET: '   ' })).toThrow(/TOKEN_SECRET/);
  });

  it('lists every missing var in one message', () => {
    const error = (() => {
      try {
        parseEnv({});
      } catch (e) {
        return e as Error;
      }
    })();
    for (const key of Object.keys(validEnv).filter((k) => k !== 'PORT')) {
      expect(error?.message).toContain(key);
    }
  });

  it.each(['abc', '-1', '70000', '3.5'])('rejects invalid PORT %s', (port) => {
    expect(() => parseEnv({ ...validEnv, PORT: port })).toThrow(/PORT/);
  });

  it.each(['not-a-url', 'localhost:5173'])('rejects invalid FRONTEND_ORIGIN %s', (origin) => {
    expect(() => parseEnv({ ...validEnv, FRONTEND_ORIGIN: origin })).toThrow(/FRONTEND_ORIGIN/);
  });

  it('rejects invalid SUPABASE_URL', () => {
    expect(() => parseEnv({ ...validEnv, SUPABASE_URL: 'nope' })).toThrow(/SUPABASE_URL/);
  });

  it('rejects a TOKEN_SECRET shorter than 32 chars', () => {
    expect(() => parseEnv({ ...validEnv, TOKEN_SECRET: 'short' })).toThrow(
      /TOKEN_SECRET: must be at least 32 characters/,
    );
  });

  it('never prints secret values in the error', () => {
    expect.assertions(3);
    try {
      parseEnv({ ...validEnv, PORT: 'abc', APP_PASSWORD: '' });
    } catch (e) {
      expect(e).toBeInstanceOf(EnvError);
      expect((e as Error).message).not.toContain(validEnv.GROQ_API_KEY);
      expect((e as Error).message).not.toContain(validEnv.TOKEN_SECRET);
    }
  });
});
