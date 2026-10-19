import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';

import { knowledgeContentEnvelopeV2Schema } from '@antica/contracts';

import { PrismaClient } from '../../generated/client.js';
import { provisionDatabaseResources } from '../../spec/resources.js';

import { canonicalHash } from '../knowledge/canonical.js';
import { validateCitation } from '../knowledge/references.js';
import { createKnowledgeImportRepository } from '../knowledge-import.js';

import { createMeasuredAdapter } from './fixtures/sql.js';

import type {
  ImportBatch,
  ImportObjectResult,
  KnowledgeImportRequest,
  MappedObject,
  ProviderSnapshot,
} from '@antica/contracts';

import type { Database } from '../../connection.js';

const now = '2026-10-19T00:00:00.000Z';
const it = test.extend<{
  database: {
    readonly db: Database;
    readonly queries: string[];
    readonly prismaQueries: string[];
  };
}>({
  database: async ({ task: _task }, use) => {
    const owned = await provisionDatabaseResources(
      process.env.ANTICA_TEST_DATABASE_URL ?? '',
      [{ id: 'import', migrate: true }],
    );
    const queries: string[] = [];
    const prismaQueries: string[] = [];
    const db = new PrismaClient({
      adapter: createMeasuredAdapter(owned.resources.import!.url, queries),
      log: [{ emit: 'event', level: 'query' }],
    });
    db.$on('query', (event) => prismaQueries.push(event.query));
    try {
      await use({ db, queries, prismaQueries });
    } finally {
      await db.$disconnect();
      await owned.close();
    }
  },
});

describe(
  'fn:createKnowledgeImportRepository:SQL accounting',
  { timeout: 60_000 },
  () => {
    it('should measure actual request, claim, transaction and checkpoint statements for a bounded run', async ({
      database: { db, queries, prismaQueries },
    }) => {
      const store = createKnowledgeImportRepository({ db, now: () => now });
      const ownerId = randomUUID();
      const input: KnowledgeImportRequest = {
        requestKey: randomUUID(),
        sqlOperationBudget: 4_000,
        selection: {
          kind: 'ids',
          provider: 'fixture',
          objectIds: Array.from(
            { length: 50 },
            (_, index) => `object-${index}`,
          ),
          maxObjects: 50,
          maxBytes: 100_000,
          deadline: '2026-10-20T00:00:00.000Z',
        },
      };
      const start = queries.length;
      const run = await store.request(ownerId, input, 'fixture-v1');
      if (run === 'conflict') {
        throw new Error('Unexpected conflict');
      }
      const batchStart = queries.length;
      const lease = await store.claim(run.jobId);
      if (!lease) {
        throw new Error('Expected lease');
      }
      const batch: ImportBatch = {
        checkpoint: { ...lease.checkpoint, offset: 50 },
        objects: lease.checkpoint.manifest.map(capturedObject),
        reason: null,
        retryAfter: null,
        stop: false,
      };
      await store.commit(lease, batch);
      const batchQueries = queries.slice(batchStart);
      const actual = queries.slice(start);
      const status = await store.get(ownerId, run.id);
      const controlQueries = queries.slice(start + actual.length);
      await writeFile(
        join(tmpdir(), 'antica-kdb10-sql-observation.json'),
        JSON.stringify(
          {
            actual,
            prismaQueries,
            batchStatements: batchQueries.length,
            totalStatements: actual.length,
            controlStatements: controlQueries.length,
            counts: status?.counts,
          },
          null,
          2,
        ),
      );

      expect(actual.some((query) => /^BEGIN\b/i.test(query))).toBe(true);
      expect(actual.some((query) => /^COMMIT\b/i.test(query))).toBe(true);
      expect(status?.counts.sqlOperations).toBe(actual.length);
      expect(controlQueries).toHaveLength(1);
      expect(status?.counts).toMatchObject({ controlSqlOperations: 1 });
      expect(status?.counts.batches).toEqual([batchQueries.length]);
      expect(batchQueries.length).toBeLessThanOrEqual(40);
      expect(status?.counts.sqlOperations).toBeLessThanOrEqual(4_000);
      expect(status?.counts.reservedOperations).toBe(0);
      expect(status).toMatchObject({
        status: 'completed',
        counts: { imported: 50, processed: 50 },
      });
      expect(
        await db.knowledgeRevisions.count({
          where: { knowledgeEntries: { ownerId } },
        }),
      ).toBe(50);
    });

    it.for(['field', 'root', 'web'] as const)(
      'should keep distinct quotes compatible with KDB06 validation for %s locators',
      async (variation, { database: { db } }) => {
        const ownerId = randomUUID();
        const store = createKnowledgeImportRepository({ db, now: () => now });
        const run = await store.request(
          ownerId,
          {
            requestKey: randomUUID(),
            sqlOperationBudget: 4_000,
            selection: {
              kind: 'ids',
              provider: 'fixture',
              objectIds: ['one'],
              maxObjects: 1,
              maxBytes: 100_000,
              deadline: '2026-10-20T00:00:00.000Z',
            },
          },
          'fixture-v1',
        );
        if (run === 'conflict') {
          throw new Error('Unexpected conflict');
        }
        const lease = await store.claim(run.jobId);
        if (!lease) {
          throw new Error('Expected lease');
        }
        const object = capturedObject('one');
        const mapped = object.mapped;
        const citations = ['Catalogue', 'object one'].map((quote) => ({
          id: randomUUID(),
          relation: 'supports' as const,
          availability: 'stored' as const,
          verification: 'located' as const,
          quote,
          source: mapped.source,
          locator:
            variation === 'web'
              ? {
                  id: randomUUID(),
                  kind: 'web' as const,
                  sourceId: mapped.source.id,
                  sourceVersionId: mapped.source.versionId,
                  url: object.snapshot.sourcePageUrl,
                  retrievedAt: now,
                  excerpt: quote,
                }
              : {
                  id: randomUUID(),
                  kind: 'structured' as const,
                  sourceId: mapped.source.id,
                  sourceVersionId: mapped.source.versionId,
                  provider: 'fixture',
                  objectId: 'one',
                  fieldPath: variation === 'root' ? '' : '/title',
                  valueHash:
                    variation === 'root'
                      ? object.snapshot.payloadHash
                      : canonicalHash('Catalogue object one'),
                  url: object.snapshot.sourcePageUrl,
                  retrievedAt: now,
                  excerpt: quote,
                },
        }));
        await store.commit(lease, {
          checkpoint: { ...lease.checkpoint, offset: 1 },
          objects: [
            {
              ...object,
              mapped: { ...mapped, draft: { ...mapped.draft, citations } },
            },
          ],
          stop: false,
          retryAfter: null,
          reason: null,
        });
        expect(await store.get(ownerId, run.id)).toMatchObject({
          status: 'completed',
          counts: { imported: 1 },
        });
        const revision = await db.knowledgeRevisions.findFirstOrThrow({
          where: { knowledgeEntries: { ownerId } },
        });
        const content = knowledgeContentEnvelopeV2Schema.parse(
          revision.content,
        );
        expect(
          new Set(content.citations.map((citation) => citation.locator.id))
            .size,
        ).toBe(variation === 'web' ? 2 : 1);
        await db.$transaction(async (tx) => {
          for (const citation of content.citations) {
            await expect(
              validateCitation({ tx, ownerId }, citation),
            ).resolves.toBeUndefined();
          }
        });
        for (const citation of content.citations) {
          const row = await db.sourceLocators.findUniqueOrThrow({
            where: { id: citation.locator.id },
          });
          expect(citation.locator.excerpt).toBe(row.excerptAsRetrieved);
        }
      },
    );

    it('should leave all three atomic request artifacts absent when PostgreSQL rejects the request', async ({
      database: { db },
    }) => {
      const store = createKnowledgeImportRepository({ db, now: () => now });
      const ownerId = randomUUID();
      const input: KnowledgeImportRequest = {
        requestKey: randomUUID(),
        sqlOperationBudget: 4_000,
        selection: {
          kind: 'ids',
          provider: 'fixture',
          objectIds: ['object-1'],
          maxObjects: 1,
          maxBytes: 10_000,
          deadline: '2026-10-20T00:00:00.000Z',
        },
      };
      await expect(
        store.request(ownerId, input, 'invalid\u0000version'),
      ).rejects.toThrow();

      expect(await db.importRun.count({ where: { ownerId } })).toBe(0);
      expect(await db.jobs.count({ where: { ownerId } })).toBe(0);
      expect(await db.outbox.count({ where: { ownerId } })).toBe(0);
    });
  },
);

/**
 * captures a valid minimal pending object for measuring bulk SQL writes
 * @param objectId bounded provider identifier
 * @returns immutable source and unreviewed object-example payload
 */
function capturedObject(
  objectId: string,
): Extract<ImportObjectResult, { kind: 'snapshot' }> {
  const payload = { title: `Catalogue object ${objectId}` };
  const identity = {
    provider: 'fixture',
    objectId,
    payloadHash: canonicalHash(payload),
    schemaVersion: 'fixture-v1',
  };
  const snapshot: ProviderSnapshot = {
    ...identity,
    sourceHash: canonicalHash(identity),
    sourcePageUrl: `https://catalog.example.invalid/${objectId}`,
    retrievedAt: now,
    payload,
  };
  const source = {
    id: randomUUID(),
    versionId: randomUUID(),
    title: payload.title,
    canonicalUrl: snapshot.sourcePageUrl,
    languages: ['en'],
    contributors: [],
    structuredSnapshot: snapshot,
  };
  const mapped: MappedObject = {
    externalObject: {
      provider: 'fixture',
      objectId,
      canonicalRecordUrl: snapshot.sourcePageUrl,
    },
    source,
    draft: {
      contentSchemaVersion: 2,
      entryType: 'object_example',
      origin: 'open_import',
      titles: [{ language: 'en', text: payload.title }],
      aliases: [],
      editorialReview: { state: 'pending' },
      sections: {
        summary: {
          claimKey: 'title',
          text: payload.title,
          citationIds: [],
          supportState: 'needs_source',
        },
        history: [],
        features: [],
        applicability: [],
        limits: [],
      },
      claims: [
        {
          claimKey: 'title',
          section: 'summary',
          ordinal: 0,
          originalText: payload.title,
          originalLanguage: 'en',
          statementType: 'observation',
          scope: {},
          qualifiers: {},
          supportState: 'needs_source',
          citationIds: [],
          review: { state: 'pending' },
          variants: [],
        },
      ],
      citations: [],
      images: [],
      topics: [],
      methodIds: [],
      relatedEntryIds: [],
    },
  };

  return {
    kind: 'snapshot',
    objectId,
    snapshot,
    mapped,
    bytes: new TextEncoder().encode(JSON.stringify({ snapshot, mapped }))
      .length,
  };
}
