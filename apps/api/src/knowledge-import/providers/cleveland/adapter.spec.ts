import { readFileSync } from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

import { z } from 'zod';

import { canonicalJsonSchema } from '@antica/contracts';

import { createClevelandAdapter } from './adapter.js';

import type { ImportSelection } from '@antica/contracts';

const signal = new AbortController().signal;
const selection = {
  kind: 'ids',
  provider: 'cleveland',
  objectIds: ['134843', '136423'],
  maxObjects: 2,
  maxBytes: 2_097_152,
  deadline: '2026-10-20T00:00:00.000Z',
} satisfies ImportSelection;

describe('fn:createClevelandAdapter', () => {
  it('should paginate approved identities without fetching collection metadata', async () => {
    const request = vi.fn<typeof fetch>();
    const adapter = createClevelandAdapter({ request });
    const first = await adapter.list({ selection, limit: 1, signal });
    expect(first).toMatchObject({
      objects: [{ objectId: '134843' }],
      next: { offset: 1, adapterVersion: 'cleveland-v1' },
    });
    expect(
      await adapter.list({ selection, cursor: first.next, limit: 1, signal }),
    ).toEqual({
      objects: [{ objectId: '136423' }],
    });
    expect(request).not.toHaveBeenCalled();
  });
  it('should report a missing museum object without attempting a retry', async () => {
    const request = vi.fn<typeof fetch>(
      async () => new Response(null, { status: 404 }),
    );
    const adapter = createClevelandAdapter({ request });
    expect(
      await adapter.fetch({ object: { objectId: '134843' }, signal }),
    ).toEqual({ kind: 'missing' });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('should defer conditional unchanged responses and expose upstream retry metadata', async () => {
    const conditional = vi.fn<typeof fetch>(
      async () => new Response(null, { status: 304 }),
    );
    expect(
      await createClevelandAdapter({ request: conditional }).fetch({
        object: { objectId: '134843' },
        etag: '"version-one"',
        signal,
      }),
    ).toEqual({ kind: 'unchanged' });
    expect(
      new Headers(conditional.mock.calls[0]?.[1]?.headers).get('if-none-match'),
    ).toBe('"version-one"');
    for (const status of [429, 503, 403]) {
      const request = vi.fn<typeof fetch>(
        async () =>
          new Response(null, {
            status,
            headers: { 'Retry-After': '120' },
          }),
      );
      await expect(
        createClevelandAdapter({ request }).fetch({
          object: { objectId: '134843' },
          signal,
        }),
      ).rejects.toMatchObject({
        retryable: status !== 403,
        retryAfter: status === 429 ? '120' : undefined,
      });
      expect(request).toHaveBeenCalledTimes(1);
    }
  });

  it('should capture a real response and recognize its timestamp on the recorded recheck', async () => {
    const capture = z
      .object({
        body: canonicalJsonSchema,
        recheck: z.object({ body: canonicalJsonSchema }),
      })
      .parse(
        JSON.parse(
          readFileSync(
            new URL('./fixtures/134843.json', import.meta.url),
            'utf8',
          ),
        ),
      );
    const request = vi.fn<typeof fetch>(async () =>
      Response.json(capture.body),
    );
    const adapter = createClevelandAdapter({ request });
    const first = await adapter.fetch({
      object: { objectId: '134843' },
      signal,
    });
    expect(first).toMatchObject({
      kind: 'snapshot',
      value: {
        provider: 'cleveland',
        objectId: '134843',
        payload: capture.body,
      },
    });
    const recheck = createClevelandAdapter({
      request: async () => Response.json(capture.recheck.body),
    });
    expect(
      await recheck.fetch({
        object: { objectId: '134843' },
        etag: '2026-10-07T12:13:19.296Z',
        signal,
      }),
    ).toEqual({ kind: 'unchanged' });
    expect(
      new Headers(request.mock.calls[0]?.[1]?.headers).get('user-agent'),
    ).toMatch(/antica/i);
  });

  it('should bound query pages and forward the monthly updated_since filter', async () => {
    const urls: URL[] = [];
    const request = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input));
      urls.push(url);

      return Response.json({
        data:
          url.searchParams.get('skip') === '0'
            ? [{ id: 134843 }, { id: 136423 }]
            : [{ id: 130197 }],
      });
    });
    const adapter = createClevelandAdapter({
      request,
      updatedSince: '2026-09-01',
    });
    const query = {
      provider: selection.provider,
      maxBytes: selection.maxBytes,
      deadline: selection.deadline,
      kind: 'query',
      query: { category: 'ceramics', text: 'China' },
      maxObjects: 3,
    } satisfies ImportSelection;
    const first = await adapter.list({ selection: query, limit: 2, signal });
    expect(first.objects).toEqual([
      { objectId: '134843' },
      { objectId: '136423' },
    ]);
    expect(
      await adapter.list({
        selection: query,
        cursor: first.next,
        limit: 2,
        signal,
      }),
    ).toEqual({ objects: [{ objectId: '130197' }] });
    expect(urls.map((url) => Object.fromEntries(url.searchParams))).toEqual([
      expect.objectContaining({
        q: 'China',
        type: 'Ceramic',
        skip: '0',
        limit: '2',
        updated_since: '2026-09-01',
      }),
      expect.objectContaining({
        q: 'China',
        type: 'Ceramic',
        skip: '2',
        limit: '1',
        updated_since: '2026-09-01',
      }),
    ]);
  });
  it('should serialize requests and leave at least one second between their starts', async () => {
    const starts: number[] = [];
    const events: string[] = [];
    const request = vi.fn<typeof fetch>(async () => {
      starts.push(Date.now());
      events.push('start');
      await new Promise((resolve) => setTimeout(resolve, 250));
      events.push('end');

      return new Response(null, { status: 404 });
    });
    const adapter = createClevelandAdapter({ request });
    const outcomes = await Promise.all(
      ['134843', '136423', '130197'].map(async (objectId) =>
        adapter.fetch({ object: { objectId }, signal }),
      ),
    );
    expect(outcomes).toEqual([
      { kind: 'missing' },
      { kind: 'missing' },
      { kind: 'missing' },
    ]);
    expect(events).toEqual(['start', 'end', 'start', 'end', 'start', 'end']);
    expect(starts[1]! - starts[0]!).toBeGreaterThanOrEqual(999);
    expect(starts[2]! - starts[1]!).toBeGreaterThanOrEqual(999);
  });

  it('should reject unsafe identifiers, invalid bounds and unbounded queries before HTTP', async () => {
    const request = vi.fn<typeof fetch>();
    const adapter = createClevelandAdapter({ request });
    for (const objectId of ['../secret', '0', '9007199254740992']) {
      await expect(
        adapter.fetch({ object: { objectId }, signal }),
      ).rejects.toMatchObject({ code: 'INVALID_OBJECT_ID', retryable: false });
    }
    for (const limit of [0, 1.5]) {
      await expect(
        adapter.list({ selection, limit, signal }),
      ).rejects.toMatchObject({ code: 'INVALID_SELECTION' });
    }
    await expect(
      adapter.list({
        selection: { ...selection, provider: 'other' },
        limit: 1,
        signal,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_SELECTION' });
    for (const query of [
      { category: 'ceramics' },
      { text: 'China' },
      { category: 'ceramics', text: '   ' },
    ] as const) {
      await expect(
        adapter.list({
          selection: {
            kind: 'query',
            provider: 'cleveland',
            query,
            maxObjects: 2,
            maxBytes: selection.maxBytes,
            deadline: selection.deadline,
          },
          limit: 1,
          signal,
        }),
      ).rejects.toMatchObject({ code: 'INVALID_SELECTION' });
    }
    expect(() =>
      createClevelandAdapter({ updatedSince: 'not-a-date' }),
    ).toThrow();
    expect(request).not.toHaveBeenCalled();
  });

  it('should reject malformed remote detail envelopes instead of creating evidence', async () => {
    for (const body of [
      null,
      4,
      [],
      {},
      { data: null },
      { data: [] },
      { data: { id: 2, url: 'https://example.org' } },
      { data: { id: 134843 } },
      { data: { id: 134843, url: 'file:///secret' } },
    ]) {
      const adapter = createClevelandAdapter({
        request: async () => Response.json(body),
      });
      await expect(
        adapter.fetch({ object: { objectId: '134843' }, signal }),
      ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    }
    const oversized = createClevelandAdapter({
      request: async () => new Response(' '.repeat(2_097_153)),
    });
    await expect(
      oversized.fetch({ object: { objectId: '134843' }, signal }),
    ).rejects.toMatchObject({ code: 'OBJECT_TOO_LARGE' });
  });

  it('should reject stale cursors and malformed query pages', async () => {
    const adapter = createClevelandAdapter({
      request: async () => Response.json({ data: [] }),
    });
    const first = await adapter.list({ selection, limit: 1, signal });
    const { offset: _offset, ...origin } = first.next!;
    expect(
      (await adapter.list({ selection, cursor: origin, limit: 1, signal }))
        .objects,
    ).toEqual(first.objects);

    for (const next of [
      { ...first.next!, queryHash: 'a'.repeat(64) },
      { ...first.next!, adapterVersion: 'old' },
      { ...first.next!, offset: 3 },
      { ...first.next!, page: 'x'.repeat(2049) },
    ]) {
      await expect(
        adapter.list({ selection, cursor: next, limit: 1, signal }),
      ).rejects.toMatchObject({ code: 'RESTART_REQUIRED' });
    }
    const query = {
      kind: 'query',
      provider: 'cleveland',
      query: { category: 'jades', text: 'China' },
      maxObjects: 2,
      maxBytes: selection.maxBytes,
      deadline: selection.deadline,
    } satisfies ImportSelection;
    for (const body of [
      null,
      4,
      [],
      {},
      { data: {} },
      { data: [null] },
      { data: [4] },
      { data: [[]] },
      { data: [{}] },
      { data: [{ id: 1 }, { id: 2 }] },
    ]) {
      const candidate = createClevelandAdapter({
        request: async () => Response.json(body),
      });
      await expect(
        candidate.list({ selection: query, limit: 1, signal }),
      ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    }
    expect(await adapter.list({ selection: query, limit: 1, signal })).toEqual({
      objects: [],
    });
  });

  it('should use the default transport and map immutable configured taxonomy hints', async () => {
    const body = {
      data: {
        id: 147587,
        title: 'Example',
        type: 'Ceramic',
        url: 'https://clevelandart.org/art/1973.84',
      },
    };
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async () =>
        Response.json(body, { headers: { ETag: '"same"' } }),
      ),
    );
    const adapter = createClevelandAdapter();
    expect(
      await adapter.fetch({
        object: { objectId: '147587' },
        etag: '"same"',
        signal,
      }),
    ).toEqual({ kind: 'unchanged' });
    const topics = [
      { topicId: 'ceramic', facet: 'object_type', text: 'Ceramic' },
    ];
    const configured = createClevelandAdapter({
      topics,
      request: async () => Response.json(body),
    });
    topics[0]!.text = 'changed';
    const fetched = await configured.fetch({
      object: { objectId: '147587' },
      signal,
    });
    if (fetched.kind !== 'snapshot') {
      throw new Error('Expected snapshot');
    }
    expect(configured.map(fetched.value).draft.topics).toEqual([
      { topicId: 'ceramic', applicability: 'specific' },
    ]);
    const timeout = createClevelandAdapter({
      request: async () => new Response(null, { status: 408 }),
    });
    await expect(
      timeout.fetch({ object: { objectId: '147587' }, signal }),
    ).rejects.toMatchObject({ retryable: true });
  });
  it('should expose a rate limit without an upstream retry deadline', async () => {
    const adapter = createClevelandAdapter({
      request: async () => new Response(null, { status: 429 }),
    });
    await expect(
      adapter.fetch({ object: { objectId: '147587' }, signal }),
    ).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      retryable: true,
      retryAfter: undefined,
    });
  });
});
