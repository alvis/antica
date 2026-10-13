import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import { mountLocalTransfers } from './local-transfers.js';

import type { ApiEnv } from './http.js';

describe('fn:mountLocalTransfers', () => {
  it('should deny an expired read without releasing private bytes', async () => {
    const app = new Hono<ApiEnv>();
    mountLocalTransfers(app, {
      validateUploadToken: vi.fn(),
      acceptUploadToken: vi.fn(),
      openReadToken: async () => {
        throw new Error('Expired signature');
      },
    });
    const response = await app.request('/v1/storage/reads/expired');
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      code: 'FORBIDDEN',
      retryable: false,
    });
  });

  it('should submit an empty body and missing MIME to final storage validation', async () => {
    const app = new Hono<ApiEnv>();
    const acceptUploadToken = vi.fn(async () => {
      throw new Error('Signed upload requires one image byte');
    });
    mountLocalTransfers(app, {
      validateUploadToken: async () => ({
        byteLength: 1,
        mimeType: 'image/png',
      }),
      acceptUploadToken,
      openReadToken: vi.fn(),
    });
    const response = await app.request('/v1/storage/uploads/signed', {
      method: 'PUT',
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: 'UPLOAD_INCOMPLETE' });
    expect(acceptUploadToken).toHaveBeenCalledExactlyOnceWith(
      'signed',
      new Uint8Array(),
      '',
    );
  });

  it('should reject an invalid signature before reading any upload bytes', async () => {
    const app = new Hono<ApiEnv>();
    const pull = vi.fn();
    const acceptUploadToken = vi.fn();
    mountLocalTransfers(app, {
      validateUploadToken: async () => {
        throw new Error('Invalid signature');
      },
      acceptUploadToken,
      openReadToken: vi.fn(),
    });
    const body = new ReadableStream<Uint8Array>({ pull }, { highWaterMark: 0 });
    const request = new Request('http://localhost/v1/storage/uploads/invalid', {
      method: 'PUT',
      body,
      duplex: 'half',
    });
    const response = await app.fetch(request);
    expect(response.status).toBe(403);
    expect(pull).not.toHaveBeenCalled();
    expect(acceptUploadToken).not.toHaveBeenCalled();
    await body.cancel();
  });

  it('should cancel an upload stream beyond the signed length without accepting partial bytes', async () => {
    const app = new Hono<ApiEnv>();
    const cancel = vi.fn();
    const acceptUploadToken = vi.fn();
    const pull = vi.fn(
      (controller: ReadableStreamDefaultController<Uint8Array>) =>
        controller.enqueue(new Uint8Array(3)),
    );
    mountLocalTransfers(app, {
      validateUploadToken: async () => ({
        byteLength: 4,
        mimeType: 'image/png',
      }),
      acceptUploadToken,
      openReadToken: vi.fn(),
    });
    const body = new ReadableStream<Uint8Array>(
      { pull, cancel },
      { highWaterMark: 0 },
    );
    const response = await app.fetch(
      new Request('http://localhost/v1/storage/uploads/valid', {
        method: 'PUT',
        body,
        headers: { 'content-length': '1', 'content-type': 'image/png' },
        duplex: 'half',
      }),
    );
    expect(response.status).toBe(413);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(pull).toHaveBeenCalledTimes(2);
    expect(acceptUploadToken).not.toHaveBeenCalled();
  });

  it('should pass exact signed bytes and MIME to final checksum verification', async () => {
    const app = new Hono<ApiEnv>();
    const acceptUploadToken = vi.fn();
    mountLocalTransfers(app, {
      validateUploadToken: async () => ({
        byteLength: 4,
        mimeType: 'image/png',
      }),
      acceptUploadToken,
      openReadToken: vi.fn(),
    });
    const response = await app.request('/v1/storage/uploads/valid', {
      method: 'PUT',
      body: new Uint8Array([1, 2, 3, 4]),
      headers: { 'content-type': 'image/png' },
    });
    expect(response.status).toBe(204);
    expect(acceptUploadToken).toHaveBeenCalledExactlyOnceWith(
      'valid',
      new Uint8Array([1, 2, 3, 4]),
      'image/png',
    );
  });
});
