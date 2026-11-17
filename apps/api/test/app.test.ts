import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { HttpError, errorHandler } from '../src/errors.js';

const FRONTEND_ORIGIN = 'http://localhost:5173';
const app = createApp({ frontendOrigin: FRONTEND_ORIGIN });

describe('GET /health', () => {
  it('returns 200 with status ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
    expect(res.headers['content-type']).toMatch(/application\/json/);
  });

  it('does not need auth', async () => {
    const res = await request(app).get('/health').set('Authorization', 'Bearer junk');
    expect(res.status).toBe(200);
  });
});

describe('CORS', () => {
  it('allows FRONTEND_ORIGIN', async () => {
    const res = await request(app).get('/health').set('Origin', FRONTEND_ORIGIN);
    expect(res.headers['access-control-allow-origin']).toBe(FRONTEND_ORIGIN);
  });

  it('answers preflight for FRONTEND_ORIGIN with Authorization header allowed', async () => {
    const res = await request(app)
      .options('/health')
      .set('Origin', FRONTEND_ORIGIN)
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'authorization,content-type');
    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe(FRONTEND_ORIGIN);
    expect(res.headers['access-control-allow-headers']?.toLowerCase()).toContain('authorization');
  });

  it('does not allow other origins', async () => {
    const res = await request(app).get('/health').set('Origin', 'https://evil.example.com');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('errors', () => {
  it('returns 404 in the error shape for unknown routes', async () => {
    const res = await request(app).get('/nope');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
  });

  it('returns 400 INVALID_JSON for a malformed body', async () => {
    const res = await request(app)
      .post('/health')
      .set('Content-Type', 'application/json')
      .send('{"bad json');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_JSON');
    expect(typeof res.body.error.message).toBe('string');
  });

  it('returns 413 PAYLOAD_TOO_LARGE for a body over 1mb', async () => {
    const res = await request(app)
      .post('/health')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ content: 'a'.repeat(1024 * 1024 + 10) }));
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('accepts a body just under 1mb', async () => {
    const res = await request(app)
      .post('/health')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ content: 'a'.repeat(1024 * 1024 - 100) }));
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

describe('errorHandler', () => {
  function appThatThrows(error: unknown) {
    const a = express();
    a.get('/boom', () => {
      throw error;
    });
    a.get('/async-boom', async () => {
      throw error;
    });
    a.use(errorHandler);
    return a;
  }

  it('maps HttpError to its status and code', async () => {
    const res = await request(appThatThrows(new HttpError(409, 'ITEM_BUSY', 'Item is busy'))).get(
      '/boom',
    );
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: { code: 'ITEM_BUSY', message: 'Item is busy' } });
  });

  it('handles errors thrown from async handlers', async () => {
    const res = await request(
      appThatThrows(new HttpError(401, 'UNAUTHORIZED', 'Unauthorized')),
    ).get('/async-boom');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('hides details of unknown errors behind a 500', async () => {
    const res = await request(appThatThrows(new Error('db password leaked'))).get('/boom');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' },
    });
  });

  it('handles non-Error throws', async () => {
    const res = await request(appThatThrows('just a string')).get('/boom');
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
  });
});
