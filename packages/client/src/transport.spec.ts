import { describe, expect, it, vi } from 'vitest';

import { ApiTransport } from './transport';

const session = {
  getCookie: async (): Promise<string> => 'session=private',
  onUnauthorized: vi.fn(),
};
const transport = new ApiTransport({
  baseUrl: 'https://api.example/',
  session,
});
const schema = { parse: (value: unknown): unknown => value };

describe('cl:ApiTransport', () => {
  it('should deliver an authenticated idempotent command and return its response', async () => {
    const request = vi.fn<typeof fetch>(async () =>
      Response.json({ saved: true }),
    );
    vi.stubGlobal('fetch', request);

    await expect(
      transport.post('/records', schema, {
        body: { name: 'Vase' },
        idempotencyKey: 'save-1',
      }),
    ).resolves.toEqual({ saved: true });
    expect(request.mock.calls).toEqual([
      [
        'https://api.example/records',
        {
          method: 'POST',
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'Cookie': 'session=private',
            'Idempotency-Key': 'save-1',
          },
          body: '{"name":"Vase"}',
          signal: undefined,
        },
      ],
    ]);
  });

  it('should invalidate a rejected session and expose the public authentication error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async () =>
        Response.json(
          {
            error: {
              code: 'SESSION_EXPIRED',
              message: 'Sign in again',
            },
          },
          { status: 401 },
        ),
      ),
    );
    await expect(transport.get('/records', schema)).rejects.toMatchObject({
      name: 'ApiError',
      status: 401,
      code: 'SESSION_EXPIRED',
      message: 'Sign in again',
    });
    expect(session.onUnauthorized).toHaveBeenCalledOnce();
  });

  it('should preserve revision conflicts and normalize unavailable public error details', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          Response.json(
            { code: 'STALE_REVISION', message: 'Reload' },
            { status: 409 },
          ),
        )
        .mockResolvedValueOnce(
          new Response('upstream unavailable', { status: 502 }),
        )
        .mockResolvedValueOnce(
          Response.json({ error: { code: 123 } }, { status: 500 }),
        ),
    );

    await expect(
      transport.patch('/records/1', schema, { body: { revision: 1 } }),
    ).rejects.toMatchObject({
      status: 409,
      code: 'STALE_REVISION',
      message: 'Reload',
    });
    await expect(transport.get('/records', schema)).rejects.toMatchObject({
      status: 502,
      code: 'REQUEST_FAILED',
    });
    await expect(transport.get('/records', schema)).rejects.toMatchObject({
      status: 500,
      code: 'REQUEST_FAILED',
    });
    expect(session.onUnauthorized).not.toHaveBeenCalled();
  });

  it('should upload private bytes without session cookies and return the part receipt', async () => {
    const request = vi.fn<typeof fetch>(
      async () => new Response(null, { headers: { etag: 'part-receipt' } }),
    );
    vi.stubGlobal('fetch', request);
    const bytes = new Blob(['private image']);
    const headers = { 'Content-Type': 'image/jpeg' };
    await expect(
      transport.putSigned('https://storage.example/signed', bytes, headers),
    ).resolves.toBe('part-receipt');
    expect(request.mock.calls).toEqual([
      [
        'https://storage.example/signed',
        { method: 'PUT', headers, body: bytes },
      ],
    ]);
  });

  it('should reject a failed signed upload and allow a retry without an etag', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(new Response(null, { status: 503 }))
        .mockResolvedValueOnce(new Response(null)),
    );
    const bytes = new Blob(['image']);
    await expect(
      transport.putSigned('https://storage.example/signed', bytes, {}),
    ).rejects.toMatchObject({ status: 503, code: 'UPLOAD_FAILED' });
    await expect(
      transport.putSigned('https://storage.example/signed', bytes, {}),
    ).resolves.toBe('');
  });
});
