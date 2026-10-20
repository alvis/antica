import { describe, expect } from 'vitest';

import { KnowledgeProviderError } from '@antica/contracts';

import {
  createImportFixture,
  createRequest,
  it,
  requestRun,
} from './fixtures/database.js';
import { createProviderFixture, createSnapshot } from './fixtures/provider.js';

import type { KnowledgeProviderAdapter, MappedObject } from '@antica/contracts';

const invalidPages = [
  { label: 'duplicate identifiers', ids: ['one', 'one'] },
  { label: 'empty identifier', ids: [''] },
  { label: 'URL identifier', ids: ['https://example.invalid/one'] },
  { label: 'oversized identifier', ids: ['x'.repeat(201)] },
  {
    label: 'oversized page',
    ids: Array.from({ length: 51 }, (_, index) => `object-${index}`),
  },
];

describe(
  'fn:createKnowledgeImportHandler:provider boundaries',
  { timeout: 60_000 },
  () => {
    for (const { label, ids } of invalidPages) {
      it(`should reject a query page with ${label} before fetching`, async ({
        database: { db },
      }) => {
        const base = createProviderFixture({ snapshots: [] });
        const adapter: KnowledgeProviderAdapter = {
          ...base,
          list: async () => ({
            objects: ids.map((objectId) => ({ objectId })),
          }),
        };
        const fixture = createImportFixture(db, adapter);
        const input = createRequest();
        const run = await requestRun(fixture, {
          ...input,
          selection: {
            provider: input.selection.provider,
            maxBytes: input.selection.maxBytes,
            deadline: input.selection.deadline,
            kind: 'query',
            query: { text: 'ceramics' },
            maxObjects: 100,
          },
        });
        await fixture.handle(run.jobId);
        expect(await fixture.store.get(fixture.ownerId, run.id)).toMatchObject({
          status: 'partial',
          reason: 'INVALID_MANIFEST',
          counts: { processed: 0 },
        });
        expect(base.fetched).toEqual([]);
      });
    }

    it('should stop an expired run without contacting the provider', async ({
      database: { db },
    }) => {
      const adapter = createProviderFixture({ snapshots: [createSnapshot()] });
      const fixture = createImportFixture(db, adapter);
      const run = await requestRun(fixture);
      fixture.clock.value = '2026-10-20T00:00:00.000Z';
      await fixture.handle(run.jobId);
      expect(await fixture.store.get(fixture.ownerId, run.id)).toMatchObject({
        status: 'partial',
        reason: 'DEADLINE_EXCEEDED',
        counts: { processed: 0 },
      });
      expect(adapter.fetched).toEqual([]);
    });

    it('should keep the first unfitted object at the checkpoint when the byte budget is exhausted', async ({
      database: { db },
    }) => {
      const fixture = createImportFixture(
        db,
        createProviderFixture({ snapshots: [createSnapshot()] }),
      );
      const input = createRequest();
      const run = await requestRun(fixture, {
        ...input,
        selection: { ...input.selection, maxBytes: 1 },
      });
      await fixture.handle(run.jobId);
      const status = await fixture.store.get(fixture.ownerId, run.id);
      expect(status).toMatchObject({
        status: 'partial',
        reason: 'BYTE_BUDGET_EXCEEDED',
        counts: { bytes: 0, processed: 0 },
      });
      expect(await db.importItem.count({ where: { runId: run.id } })).toBe(0);
      expect(
        await db.sourceVersions.count({ where: { ownerId: fixture.ownerId } }),
      ).toBe(0);
    });

    it('should retain the latest retry minimum across failed objects and sanitize unknown exceptions', async ({
      database: { db },
    }) => {
      const adapter = createProviderFixture({ snapshots: [] });
      const fixture = createImportFixture(db, {
        ...adapter,
        fetch: async ({ object }) => {
          if (object.objectId === 'one') {
            throw new KnowledgeProviderError({
              code: 'UNAVAILABLE',
              retryable: true,
              retryAfter: 'Mon, 19 Oct 2026 00:02:00 GMT',
            });
          }
          if (object.objectId === 'two') {
            throw new KnowledgeProviderError({
              code: 'UNAVAILABLE',
              retryable: true,
              retryAfter: 'invalid-date',
            });
          }
          throw new Error('private upstream response must not be persisted');
        },
      });
      const run = await requestRun(
        fixture,
        createRequest(['one', 'two', 'three']),
      );
      await fixture.handle(run.jobId);
      expect(await fixture.store.get(fixture.ownerId, run.id)).toMatchObject({
        retryAfter: '2026-10-19T00:02:00.000Z',
        counts: { failed: 3 },
        retryList: expect.arrayContaining([
          { objectId: 'three', attemptCount: 1, errorCode: 'PROVIDER_FAILURE' },
        ]),
      });
      expect(
        JSON.stringify(
          await db.importItem.findMany({ where: { runId: run.id } }),
        ),
      ).not.toContain('private upstream');
    });

    it('should defer a failed listing without creating object receipts', async ({
      database: { db },
    }) => {
      const base = createProviderFixture({ snapshots: [] });
      const fixture = createImportFixture(db, {
        ...base,
        list: async () => {
          throw new KnowledgeProviderError({
            code: 'RATE_LIMITED',
            retryable: true,
            retryAfter: '30',
          });
        },
      });
      const input = createRequest();
      const run = await requestRun(fixture, {
        ...input,
        selection: {
          provider: input.selection.provider,
          maxBytes: input.selection.maxBytes,
          deadline: input.selection.deadline,
          maxObjects: input.selection.maxObjects,
          kind: 'query',
          query: { text: 'ceramics' },
        },
      });
      await fixture.handle(run.jobId);
      expect(await fixture.store.get(fixture.ownerId, run.id)).toMatchObject({
        retryAfter: '2026-10-19T00:00:30.000Z',
        counts: { processed: 0 },
      });
      expect(await db.importItem.count({ where: { runId: run.id } })).toBe(0);
    });
  },
);

const corruptMappings: ReadonlyArray<{
  readonly label: string;
  readonly change: (mapped: MappedObject) => MappedObject;
}> = [
  {
    label: 'canonical source URL',
    change: (mapped) => ({
      ...mapped,
      externalObject: {
        ...mapped.externalObject,
        canonicalRecordUrl: 'https://other.example.invalid/',
      },
    }),
  },
  {
    label: 'citation quote',
    change: (mapped) => ({
      ...mapped,
      draft: {
        ...mapped.draft,
        citations: mapped.draft.citations.map((citation) => ({
          ...citation,
          quote: 'fabricated quote',
        })),
      },
    }),
  },
  {
    label: 'captured field hash',
    change: (mapped) => ({
      ...mapped,
      draft: {
        ...mapped.draft,
        citations: mapped.draft.citations.map((citation) => ({
          ...citation,
          locator:
            citation.locator.kind === 'structured'
              ? { ...citation.locator, valueHash: '0'.repeat(64) }
              : citation.locator,
        })),
      },
    }),
  },
  {
    label: 'original variant hash',
    change: (mapped) => ({
      ...mapped,
      draft: {
        ...mapped.draft,
        claims: mapped.draft.claims.map((claim) => ({
          ...claim,
          variants: claim.variants.map((variant) => ({
            ...variant,
            sourceTextHash: '0'.repeat(64),
          })),
        })),
      },
    }),
  },
  {
    label: 'image provider',
    change: (mapped) => ({
      ...mapped,
      draft: {
        ...mapped.draft,
        images: mapped.draft.images.map((image) => ({
          ...image,
          provider: 'different',
        })),
      },
    }),
  },
];

describe(
  'fn:createKnowledgeImportHandler:evidence rejection',
  { timeout: 60_000 },
  () => {
    for (const { label, change } of corruptMappings) {
      it(`should reject a mismatched ${label} atomically and retain a permanent receipt`, async ({
        database: { db },
      }) => {
        const base = createProviderFixture({ snapshots: [createSnapshot()] });
        const fixture = createImportFixture(db, {
          ...base,
          map: (snapshot) => change(base.map(snapshot)),
        });
        const run = await requestRun(fixture);
        await fixture.handle(run.jobId);
        expect(await fixture.store.get(fixture.ownerId, run.id)).toMatchObject({
          status: 'partial',
          counts: { imported: 0, failed: 1 },
        });
        expect(
          await db.importItem.findMany({ where: { runId: run.id } }),
        ).toMatchObject([
          { status: 'failed', errorCode: expect.stringMatching(/^PERMANENT:/) },
        ]);
        expect(
          await db.sourceVersions.count({
            where: { ownerId: fixture.ownerId },
          }),
        ).toBe(0);
        expect(
          await db.externalObject.count({
            where: { ownerId: fixture.ownerId },
          }),
        ).toBe(0);
      });
    }
  },
);

describe(
  'fn:createKnowledgeImportHandler:cursor and object limits',
  { timeout: 60_000 },
  () => {
    it.for(['query', 'adapter', 'empty'] as const)(
      'should reject a provider cursor with %s mismatch before fetching',
      async (variation, { database: { db } }) => {
        const base = createProviderFixture({
          snapshots: [createSnapshot('one'), createSnapshot('two')],
          pageSize: 1,
        });
        const fixture = createImportFixture(db, {
          ...base,
          list: async (input) => {
            const page = await base.list(input);
            if (!page.next) {
              throw new Error('Expected fixture cursor');
            }

            return {
              objects: variation === 'empty' ? [] : page.objects,
              next: {
                ...page.next,
                queryHash:
                  variation === 'query' ? '0'.repeat(64) : page.next.queryHash,
                adapterVersion:
                  variation === 'adapter'
                    ? 'other-v2'
                    : page.next.adapterVersion,
              },
            };
          },
        });
        const run = await requestRun(fixture, {
          ...createRequest(),
          selection: {
            kind: 'query',
            provider: 'fixture',
            query: { text: 'ceramics' },
            maxObjects: 3,
            maxBytes: 2_097_152,
            deadline: '2026-10-20T00:00:00.000Z',
          },
        });
        await fixture.handle(run.jobId);
        expect(await fixture.store.get(fixture.ownerId, run.id)).toMatchObject({
          status: 'partial',
          reason:
            variation === 'empty' ? 'INVALID_MANIFEST' : 'RESTART_REQUIRED',
          counts: { processed: 0 },
        });
        expect(base.fetched).toEqual([]);
      },
    );

    it.for(['identity', 'size'] as const)(
      'should retain a permanent receipt for invalid snapshot %s without writing evidence',
      async (variation, { database: { db } }) => {
        const snapshot = createSnapshot();
        const base = createProviderFixture({ snapshots: [snapshot] });
        const fixture = createImportFixture(db, {
          ...base,
          fetch: async () => ({
            kind: 'snapshot',
            value:
              variation === 'identity'
                ? { ...snapshot, provider: 'another-provider' }
                : {
                    ...snapshot,
                    payload: {
                      title: '青花瓷瓶',
                      images: [],
                      description: Array.from({ length: 20 }, () =>
                        'Human catalogue description. '.repeat(700),
                      ),
                    },
                  },
          }),
        });
        const run = await requestRun(fixture);
        await fixture.handle(run.jobId);
        expect(
          await db.importItem.findMany({ where: { runId: run.id } }),
        ).toMatchObject([
          {
            status: 'failed',
            attemptCount: 1,
            errorCode: `PERMANENT:${variation === 'identity' ? 'OBJECT_IDENTITY_MISMATCH' : 'OBJECT_TOO_LARGE'}`,
          },
        ]);
        expect(
          await db.sourceVersions.count({
            where: { ownerId: fixture.ownerId },
          }),
        ).toBe(0);
        fixture.clock.value = '2026-10-19T00:10:00.000Z';
        await fixture.handle(run.jobId);
        expect(
          await db.importItem.findMany({ where: { runId: run.id } }),
        ).toMatchObject([{ attemptCount: 1 }]);
      },
    );
  },
);
