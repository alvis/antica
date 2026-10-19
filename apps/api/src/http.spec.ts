import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { invalid, jsonBody, RequestBodyError, respond } from './http.js';

const app = new Hono();
app.post('/body', async (context) => context.json(await jsonBody(context)));
app.get('/invalid', (context) => invalid(context, 'recordId'));
app.get('/result', (context) =>
  respond(context, { success: true, data: { id: 'record-1' } }, 201),
);
app.onError((error, context) =>
  context.json({ rejected: error instanceof RequestBodyError }, 413),
);

describe('fn:jsonBody', () => {
  it('should parse a normal bilingual request body', async () => {
    const response = await app.request('/body', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '青釉瓶 / Celadon vase' }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ name: '青釉瓶 / Celadon vase' });
  });

  it('should reject an oversized body even when no Content-Length header is supplied', async () => {
    const response = await app.request('/body', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'x'.repeat(1_048_577) }),
    });

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ rejected: true });
  });

  it('should reject an oversized body when the caller understates Content-Length', async () => {
    const response = await app.request('/body', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': '2' },
      body: JSON.stringify({ name: 'x'.repeat(1_048_577) }),
    });

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ rejected: true });
  });

  it('should reject a declared oversized body before parsing it', async () => {
    const response = await app.request('/body', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': '1048577',
      },
      body: '{}',
    });

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ rejected: true });
  });

  it('should reject a request without JSON bytes', async () => {
    const response = await app.request('/body', { method: 'POST' });

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ rejected: false });
  });
});

describe('fn:respond', () => {
  it('should preserve a successful result and its selected creation status', async () => {
    const response = await app.request('/result');

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ id: 'record-1' });
  });

  it.each([
    ['AUTH_REQUIRED', 401],
    ['FORBIDDEN', 403],
    ['NOT_FOUND', 404],
    ['RATE_LIMITED', 429],
    ['REVISION_CONFLICT', 409],
    ['REQUEST_IN_PROGRESS', 409],
    ['UPLOAD_INCOMPLETE', 409],
    ['UPLOAD_ALREADY_COMPLETED', 409],
    ['UPLOAD_EXPIRED', 410],
    ['UPLOAD_STORED', 409],
    ['INDEX_NOT_READY', 409],
    ['VALIDATION_FAILED', 422],
    ['EVIDENCE_INVALID', 422],
    ['MEDIA_UNSUPPORTED', 422],
    ['MODEL_CAPABILITY_MISMATCH', 422],
    ['MODEL_UNKNOWN', 422],
    ['MODEL_OUTPUT_INVALID', 500],
    ['PROVIDER_UNAVAILABLE', 503],
    ['SOURCE_UNAVAILABLE', 503],
    ['JOB_FAILED', 503],
    ['OTP_INVALID', 401],
    ['OTP_EXPIRED', 410],
  ] as const)(
    'should expose %s with its public HTTP status',
    async (code, status) => {
      const resultApp = new Hono();
      resultApp.get('/', (context) =>
        respond(context, {
          success: false,
          error: { code, message: 'Unavailable', retryable: false },
        }),
      );
      const response = await resultApp.request('/');

      expect(response.status).toBe(status);
      expect(await response.json()).toMatchObject({
        code,
        retryable: false,
        requestId: expect.any(String),
      });
    },
  );
});

describe('fn:invalid', () => {
  it('should identify the invalid field without revealing parser details', async () => {
    const response = await app.request('/invalid');

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      code: 'VALIDATION_FAILED',
      field: 'recordId',
      retryable: false,
      requestId: expect.any(String),
    });
  });
});
