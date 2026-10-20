import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { canonicalJsonSchema } from '@antica/contracts';

import { createMetAdapter } from './adapter.js';

import type { ImportSelection } from '@antica/contracts';

const signal = new AbortController().signal;
const selection = {
  kind: 'ids',
  provider: 'met',
  objectIds: ['53953', '39637'],
  maxObjects: 2,
  maxBytes: 2_097_152,
  deadline: '2026-10-20T00:00:00.000Z',
} satisfies ImportSelection;
const capture = z
  .object({ body: z.record(z.string(), canonicalJsonSchema) })
  .parse(
    JSON.parse(
      readFileSync(new URL('./fixtures/53953.json', import.meta.url), 'utf8'),
    ),
  );
const querySelection = {
  kind: 'query',
  provider: 'met',
  query: { category: 'ceramics', text: 'vase' },
  maxObjects: 3,
  maxBytes: selection.maxBytes,
  deadline: selection.deadline,
} satisfies ImportSelection;

describe('fn:createMetAdapter', () => {
  it('should paginate explicit identities without HTTP and reject duplicate explicit IDs', async () => {
    const request = vi.fn<typeof fetch>();
    const adapter = createMetAdapter({ request });
    const first = await adapter.list({ selection, limit: 1, signal });
    expect(first).toMatchObject({
      objects: [{ objectId: '53953' }],
      next: { offset: 1, adapterVersion: 'met-v1' },
    });
    expect(
      await adapter.list({ selection, cursor: first.next, limit: 1, signal }),
    ).toEqual({ objects: [{ objectId: '39637' }] });
    await expect(
      adapter.list({
        selection: { ...selection, objectIds: ['53953', '53953'] },
        limit: 1,
        signal,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_SELECTION' });
    expect(request).not.toHaveBeenCalled();
  });

  it('should distinguish missing and conditional unchanged objects without retrying', async () => {
    for (const [status, kind] of [
      [404, 'missing'],
      [304, 'unchanged'],
    ] as const) {
      const request = vi.fn<typeof fetch>(
        async () => new Response(null, { status }),
      );
      expect(
        await createMetAdapter({ request }).fetch({
          object: { objectId: '53953' },
          etag: '"version-one"',
          signal,
        }),
      ).toEqual({ kind });
      expect(
        request.mock.calls.map(([input, init]) => [
          input,
          { ...init, headers: Object.fromEntries(new Headers(init?.headers)) },
        ]),
      ).toEqual([
        [
          new URL(
            'https://collectionapi.metmuseum.org/public/collection/v1/objects/53953',
          ),
          {
            headers: {
              'accept': 'application/json',
              'if-none-match': '"version-one"',
              'user-agent': expect.stringMatching(/antica/i),
            },
            signal,
            redirect: 'error',
          },
        ],
      ]);
    }
  });

  it('should expose rate limits and transient versus permanent failures for framework retry', async () => {
    for (const status of [429, 408, 503, 403]) {
      const request = vi.fn<typeof fetch>(
        async () =>
          new Response(null, { status, headers: { 'Retry-After': '120' } }),
      );
      await expect(
        createMetAdapter({ request }).fetch({
          object: { objectId: '53953' },
          signal,
        }),
      ).rejects.toMatchObject({
        retryable: status !== 403,
        retryAfter: status === 429 ? '120' : undefined,
      });
      expect(request).toHaveBeenCalledTimes(1);
    }
    await expect(
      createMetAdapter({
        request: async () => new Response(null, { status: 429 }),
      }).fetch({ object: { objectId: '53953' }, signal }),
    ).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      retryable: true,
      retryAfter: undefined,
    });
    const offline = new TypeError('Network unavailable');
    await expect(
      createMetAdapter({
        request: async () => {
          throw offline;
        },
      }).fetch({ object: { objectId: '53953' }, signal }),
    ).rejects.toThrow();
  });

  it('should capture exact payload and rights facts and recognize metadataDate, normalized date, payload hash and ETag', async () => {
    const request = vi.fn<typeof fetch>(async () =>
      Response.json(capture.body),
    );
    const result = await createMetAdapter({ request }).fetch({
      object: { objectId: '53953' },
      signal,
    });
    expect(result).toMatchObject({
      kind: 'snapshot',
      value: {
        provider: 'met',
        objectId: '53953',
        schemaVersion: 'met-v1',
        payload: capture.body,
        sourcePageUrl: capture.body.objectURL,
        observedRights: [
          {
            statement: 'true',
            fieldPath: '/isPublicDomain',
            evidenceUrl: capture.body.objectURL,
            evidenceHash: createHash('sha256').update('true').digest('hex'),
          },
          {
            statement: '""',
            fieldPath: '/rightsAndReproduction',
            evidenceUrl: capture.body.objectURL,
            evidenceHash: createHash('sha256').update('""').digest('hex'),
          },
        ],
      },
    });
    if (result.kind !== 'snapshot') {
      throw new Error('Expected snapshot');
    }
    for (const etag of [
      z.string().parse(capture.body.metadataDate),
      new Date(z.string().parse(capture.body.metadataDate)).toISOString(),
      result.value.payloadHash,
      '"upstream"',
    ]) {
      const candidate = createMetAdapter({
        request: async () =>
          Response.json(capture.body, { headers: { ETag: '"upstream"' } }),
      });
      expect(
        await candidate.fetch({ object: { objectId: '53953' }, etag, signal }),
      ).toEqual({ kind: 'unchanged' });
    }
    expect(
      request.mock.calls.map(([input, init]) => [
        input,
        { ...init, headers: Object.fromEntries(new Headers(init?.headers)) },
      ]),
    ).toEqual([
      [
        new URL(
          'https://collectionapi.metmuseum.org/public/collection/v1/objects/53953',
        ),
        {
          headers: {
            'accept': 'application/json',
            'user-agent': expect.stringMatching(/antica/i),
          },
          signal,
          redirect: 'error',
        },
      ],
    ]);
  });

  it('should paginate v1.1 queries with China, department and material bounds', async () => {
    const urls: URL[] = [];
    const request = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input));
      urls.push(url);

      return Response.json({
        total: 3,
        objectIDs:
          url.searchParams.get('offset') === '0' ? [53953, 39637] : [56369],
      });
    });
    const adapter = createMetAdapter({ request });
    const first = await adapter.list({
      selection: querySelection,
      limit: 2,
      signal,
    });
    expect(first).toMatchObject({
      objects: [{ objectId: '53953' }, { objectId: '39637' }],
      next: { offset: 2, adapterVersion: 'met-v1' },
    });
    expect(
      await adapter.list({
        selection: querySelection,
        cursor: first.next,
        limit: 2,
        signal,
      }),
    ).toEqual({ objects: [{ objectId: '56369' }] });
    expect(
      urls.map((url) => ({
        pathname: url.pathname,
        query: Object.fromEntries(url.searchParams),
      })),
    ).toEqual([
      {
        pathname: '/public/collection/v1.1/search',
        query: {
          q: 'vase',
          geoLocation: 'China',
          departmentId: '6',
          medium: 'Ceramics',
          offset: '0',
          limit: '2',
        },
      },
      {
        pathname: '/public/collection/v1.1/search',
        query: {
          q: 'vase',
          geoLocation: 'China',
          departmentId: '6',
          medium: 'Ceramics',
          offset: '2',
          limit: '1',
        },
      },
    ]);
  });

  it('should support text-only and category-only searches within the framework object bound', async () => {
    for (const [category, medium] of [
      ['ceramics', 'Ceramics'],
      ['bronzes', 'Bronze'],
      ['jades', 'Jade'],
      ['furniture', 'Wood'],
    ] as const) {
      const request = vi.fn<typeof fetch>(async () =>
        Response.json({ total: 0, objectIDs: null }),
      );
      expect(
        await createMetAdapter({ request }).list({
          selection: {
            ...querySelection,
            query: { category },
            maxObjects: 250,
          },
          limit: 900,
          signal,
        }),
      ).toEqual({ objects: [] });
      expect(
        request.mock.calls.map(([input, init]) => [
          Object.fromEntries(z.instanceof(URL).parse(input).searchParams),
          init,
        ]),
      ).toEqual([
        [
          {
            q: expect.stringMatching(/\S/),
            medium,
            limit: '250',
            offset: '0',
            geoLocation: 'China',
            departmentId: '6',
          },
          { headers: expect.any(Headers), signal, redirect: 'error' },
        ],
      ]);
    }
    const request = vi.fn<typeof fetch>(async () =>
      Response.json({ total: 2, objectIDs: [53953, 53953] }),
    );
    expect(
      await createMetAdapter({ request }).list({
        selection: { ...querySelection, query: { text: ' bell ' } },
        limit: 2,
        signal,
      }),
    ).toEqual({ objects: [{ objectId: '53953' }, { objectId: '53953' }] });
    expect(
      request.mock.calls.map(([input, init]) => [
        Object.fromEntries(z.instanceof(URL).parse(input).searchParams),
        init,
      ]),
    ).toEqual([
      [
        {
          q: 'bell',
          limit: '2',
          offset: '0',
          geoLocation: 'China',
          departmentId: '6',
        },
        { headers: expect.any(Headers), signal, redirect: 'error' },
      ],
    ]);
  });

  it('should consume the real captured search response', async () => {
    const search = z
      .object({
        body: z.object({ total: z.number(), objectIDs: z.array(z.number()) }),
      })
      .parse(
        JSON.parse(
          readFileSync(
            new URL('./fixtures/search.json', import.meta.url),
            'utf8',
          ),
        ),
      );
    const adapter = createMetAdapter({
      request: async () => Response.json(search.body),
    });
    const page = await adapter.list({
      selection: {
        ...querySelection,
        maxObjects: search.body.objectIDs.length,
      },
      limit: search.body.objectIDs.length,
      signal,
    });
    expect(page).toEqual({
      objects: search.body.objectIDs.map((objectID) => ({
        objectId: String(objectID),
      })),
    });
  });

  it('should reject unsafe IDs, invalid bounds, mismatched providers and unbounded queries before HTTP', async () => {
    const request = vi.fn<typeof fetch>();
    const adapter = createMetAdapter({ request });
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
    for (const query of [{}, { text: '   ' }]) {
      await expect(
        adapter.list({
          selection: { ...querySelection, query },
          limit: 1,
          signal,
        }),
      ).rejects.toMatchObject({ code: 'INVALID_SELECTION' });
    }
    expect(request).not.toHaveBeenCalled();
  });

  it('should reject stale cursors and malformed query pages and stop an exhausted listing', async () => {
    const request = vi.fn<typeof fetch>(async () =>
      Response.json({ total: 0, objectIDs: [] }),
    );
    const adapter = createMetAdapter({ request });
    const first = await adapter.list({ selection, limit: 1, signal });
    const { offset: _offset, ...origin } = first.next!;
    expect(
      (await adapter.list({ selection, cursor: origin, limit: 1, signal }))
        .objects,
    ).toEqual(first.objects);
    for (const cursor of [
      { ...first.next!, queryHash: 'a'.repeat(64) },
      { ...first.next!, adapterVersion: 'old' },
      { ...first.next!, offset: 3 },
      { ...first.next!, page: 'x'.repeat(2049) },
    ]) {
      await expect(
        adapter.list({ selection, cursor, limit: 1, signal }),
      ).rejects.toMatchObject({ code: 'RESTART_REQUIRED' });
    }
    expect(
      await adapter.list({
        selection,
        cursor: { ...first.next!, offset: 2 },
        limit: 1,
        signal,
      }),
    ).toEqual({ objects: [] });
    for (const body of [
      null,
      4,
      [],
      {},
      { total: -1, objectIDs: [] },
      { total: 1, objectIDs: {} },
      { total: 1, objectIDs: [null] },
      { total: 1, objectIDs: ['53953'] },
      { total: 1, objectIDs: [0] },
      { total: 1, objectIDs: [9007199254740992] },
      { total: 2, objectIDs: [53953, 39637] },
    ]) {
      await expect(
        createMetAdapter({ request: async () => Response.json(body) }).list({
          selection: querySelection,
          limit: 1,
          signal,
        }),
      ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    }
    expect(
      await adapter.list({ selection: querySelection, limit: 1, signal }),
    ).toEqual({ objects: [] });
  });

  it('should reject malformed remote details and oversized responses before evidence creation', async () => {
    for (const body of [
      null,
      4,
      [],
      {},
      { data: capture.body },
      { objectID: 2, objectURL: 'https://example.org' },
      { objectID: 53953 },
      { objectID: 53953, objectURL: 'file:///secret' },
    ]) {
      await expect(
        createMetAdapter({ request: async () => Response.json(body) }).fetch({
          object: { objectId: '53953' },
          signal,
        }),
      ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    }
    await expect(
      createMetAdapter({
        request: async () => new Response(' '.repeat(2_097_153)),
      }).fetch({ object: { objectId: '53953' }, signal }),
    ).rejects.toMatchObject({ code: 'OBJECT_TOO_LARGE' });
    await expect(
      createMetAdapter({ request: async () => new Response('{invalid') }).fetch(
        { object: { objectId: '53953' }, signal },
      ),
    ).rejects.toThrow();
  });

  it('should use default fetch and isolate configured taxonomy from subsequent caller mutations', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async () => Response.json(capture.body)),
    );
    const adapter = createMetAdapter();
    const result = await adapter.fetch({
      object: { objectId: '53953' },
      signal,
    });
    if (result.kind !== 'snapshot') {
      throw new Error('Expected snapshot');
    }
    expect(adapter.map(result.value).draft.topics).toEqual([]);
    const topics = [{ topicId: 'china', facet: 'region', text: 'China' }];
    const configured = createMetAdapter({ topics });
    topics[0]!.text = 'changed';
    topics.push({ topicId: 'new-topic', facet: 'region', text: 'China' });
    expect(configured.map(result.value).draft.topics).toEqual([
      { topicId: 'china', applicability: 'specific' },
    ]);
  });

  it('should serialize requests with at least one second between starts', async () => {
    const starts: number[] = [];
    const events: string[] = [];
    const adapter = createMetAdapter({
      request: async () => {
        starts.push(Date.now());
        events.push('start');
        await new Promise((resolve) => setTimeout(resolve, 250));
        events.push('end');

        return new Response(null, { status: 404 });
      },
    });
    expect(
      await Promise.all(
        ['53953', '39637', '56369'].map(async (objectId) =>
          adapter.fetch({ object: { objectId }, signal }),
        ),
      ),
    ).toEqual([{ kind: 'missing' }, { kind: 'missing' }, { kind: 'missing' }]);
    expect(events).toEqual(['start', 'end', 'start', 'end', 'start', 'end']);
    expect(starts[1]! - starts[0]!).toBeGreaterThanOrEqual(999);
    expect(starts[2]! - starts[1]!).toBeGreaterThanOrEqual(999);
  });
});
