import { createHash, randomUUID } from 'node:crypto';

import { tmpdir } from 'node:os';

import { describe, expect, inject } from 'vitest';

import { createLocalMediaStore } from '../../storage/local.js';

import { jsonValue } from '../json.js';
import { createRetrievalReaders } from '../retrieval.js';
import { createDatabaseTest } from '../spec/fixtures/runner.js';
import { createTransactionPort } from '../transaction.js';

import { runKnowledgeAudit } from './knowledge/audit-cli.js';
import { auditKnowledge } from './knowledge/audit.js';
import { canonicalHash } from './knowledge/canonical.js';
import { projectKnowledge } from './knowledge/projections.js';
import { createKnowledgeRepository } from './knowledge.js';
import { createSourceRepository } from './sources.js';

import type { KnowledgeContentEnvelopeV2 } from '@antica/contracts';

import type {
  InspectionMethodVersion,
  KnowledgeEntry,
  SourceCitation,
} from '@antica/domain';

const resources = inject('platformDatabases');
const it = createDatabaseTest(resources.knowledge!);

const instant = '2026-10-13T00:00:00.000Z';

describe('fn:createKnowledgeRepository', { timeout: 30_000 }, () => {
  it('should keep v2 drafts out of legacy text retrieval without preventing analysis', async ({
    connection,
  }) => {
    const ownerId = randomUUID();
    const entryId = randomUUID();
    await connection.db.$transaction(async (tx) => {
      await createKnowledgeRepository(tx, ownerId).createV2({
        entryId,
        displayCode: `KN-${entryId}`,
        content: knowledgeEnvelope(),
        status: 'draft',
        savedBy: null,
        reviewedBy: null,
        reviewedAt: null,
      });
    });
    const readers = createRetrievalReaders({
      db: connection.db,
      transaction: createTransactionPort(connection.db),
      storage: createLocalMediaStore({
        root: tmpdir(),
        publicBaseUrl: 'http://localhost:8080',
        signingSecret: 'retrieval-test-signing-secret-32-characters',
      }),
      ownerId,
    });

    await expect(readers.readTextEntries()).resolves.toEqual([]);
  });

  it('should retain the last explicitly saved head while a newer draft becomes current', async ({
    connection,
  }) => {
    const ownerId = randomUUID();
    const entry = {
      ...knowledgeEntry(),
      status: 'saved' as const,
      savedBy: 'collector' as const,
    };
    await connection.db.$transaction(async (tx) => {
      const repository = createKnowledgeRepository(tx, ownerId);
      await repository.create(entry);
      expect(
        await repository.addRevision(
          { ...entry, revision: 2, status: 'draft', savedBy: null },
          1,
        ),
      ).toBe(true);
      expect(
        await tx.knowledgeEntries.findUnique({ where: { id: entry.id } }),
      ).toMatchObject({ currentRevision: 2, latestSavedRevision: 1 });
      expect((await repository.get(entry.id, 1))?.entry).toEqual(entry);
      expect((await repository.get(entry.id))?.entry).toMatchObject({
        revision: 2,
        status: 'draft',
        savedBy: null,
      });
      expect(
        await createKnowledgeRepository(tx, randomUUID()).get(entry.id, 1),
      ).toBeNull();
      expect(await repository.getV2(entry.id)).toMatchObject({
        entry: { revision: 2 },
      });
      expect(await repository.addRevision({ ...entry, revision: 3 }, 2)).toBe(
        true,
      );
      expect(
        await tx.knowledgeEntries.findUnique({ where: { id: entry.id } }),
      ).toMatchObject({ currentRevision: 3, latestSavedRevision: 3 });
    });
  });

  it('should retain filtered matches and their cursor order beyond 501 newer nonmatches', async ({
    connection,
  }) => {
    const ownerId = randomUUID();
    const sourceId = randomUUID();
    const sourceVersionId = randomUUID();
    const materialId = randomUUID();
    const citation: SourceCitation = {
      id: randomUUID(),
      locator: {
        kind: 'web',
        sourceId,
        sourceVersionId,
        url: 'https://example.invalid/selected-catalog',
        retrievedAt: instant,
        snapshotAssetId: null,
        blockId: null,
        excerptAsRetrieved: 'Selected material',
      },
      relation: 'background',
      availability: 'link_only',
      verification: 'located',
    };
    const base = knowledgeEntry();
    const content = {
      ...base.content,
      citations: [citation],
      applicability: [
        {
          scope: 'specific' as const,
          objectTypeIds: [],
          materialIds: [materialId],
          periodIds: [],
          regionIds: [],
          limits: base.content.summary,
        },
      ],
    };
    const newest = {
      ...knowledgeEntry(),
      content,
      updatedAt: '2026-10-15T00:00:00.000Z',
    };
    const older = Array.from({ length: 3 }, () => ({
      ...knowledgeEntry(),
      content,
    })).sort((left, right) => right.id.localeCompare(left.id));
    const unrelated = Array.from({ length: 501 }, () => knowledgeEntry());
    await connection.db.$transaction(async (tx) => {
      await tx.sources.createMany({
        data: {
          id: sourceId,
          ownerId,
          kind: 'web',
          title: 'Selected catalog',
          authorStatus: 'unknown',
          access: 'link_only',
        },
      });
      await tx.sourceVersions.createMany({
        data: {
          id: sourceVersionId,
          sourceId,
          ownerId,
          sourceHash: 'a'.repeat(64),
          metadataSnapshot: {},
          capturedAt: instant,
          status: 'registered',
          textIndexStatus: 'registered',
          imageIndexStatus: 'registered',
        },
      });
      await createSourceRepository(tx, ownerId).addCitation(citation);
      const repository = createKnowledgeRepository(tx, ownerId);
      for (const entry of [newest, ...older]) {
        await repository.create(entry);
      }
      await tx.knowledgeEntries.createMany({
        data: unrelated.map((entry) => ({
          id: entry.id,
          ownerId,
          displayCode: entry.displayCode,
          currentRevision: 1,
          updatedAt: '2026-10-14T00:00:00.000Z',
        })),
      });
      await tx.knowledgeRevisions.createMany({
        data: unrelated.map((entry) => ({
          entryId: entry.id,
          revision: 1,
          status: entry.status,
          titleZhHant: entry.content.titleZhHant,
          summaryZhHant: entry.content.summary.textZhHant,
          content: jsonValue(entry.content),
          contentHash: 'b'.repeat(64),
        })),
      });
      await repository.create({
        ...knowledgeEntry(),
        content: { ...content, citations: [] },
        updatedAt: newest.updatedAt,
      });
      await repository.create({
        ...knowledgeEntry(),
        content: { ...content, applicability: [] },
        updatedAt: newest.updatedAt,
      });

      const filters = {
        sourceIds: [sourceId],
        materialIds: [materialId],
        includeUnknown: false,
      };
      const first = await repository.query({ filters, limit: 1 });
      expect(first.items.map(({ id }) => id)).toEqual([newest.id]);
      expect(first.nextCursor).not.toBeNull();
      const second = await repository.query({
        filters,
        limit: 2,
        cursor: first.nextCursor!,
      });
      expect(second.items.map(({ id }) => id)).toEqual(
        older.slice(0, 2).map(({ id }) => id),
      );
      expect(second.nextCursor).not.toBeNull();
      const last = await repository.query({
        filters,
        limit: 2,
        cursor: second.nextCursor!,
      });
      expect(last).toMatchObject({
        items: [{ id: older[2]!.id }],
        nextCursor: null,
      });
      await expect(
        repository.query({
          filters: { ...filters, materialIds: [randomUUID()] },
          cursor: first.nextCursor!,
        }),
      ).rejects.toThrow();
      expect(
        (await createKnowledgeRepository(tx, randomUUID()).query({ filters }))
          .items,
      ).toEqual([]);
    });
  });

  it('should preserve revisions, linked method versions and ownership boundaries', async ({
    connection,
  }) => {
    const database = connection;
    const ownerId = randomUUID();
    const entry = knowledgeEntry();
    const methodId = randomUUID();
    const version: InspectionMethodVersion = {
      id: randomUUID(),
      methodId,
      revision: 1,
      createdAt: instant,
      definition: {
        titleZhHant: '檢查',
        history: [],
        featureEntryIds: [],
        applicability: [],
        observationModes: ['phone_photo'],
        steps: [],
        interpretationLimits: [],
        exampleReferenceImageIds: [],
        citations: [],
      },
    };
    const method = {
      id: methodId,
      owningEntryId: entry.id,
      currentVersionId: version.id,
    };
    await database.db.$transaction(async (tx) => {
      const repository = createKnowledgeRepository(tx, ownerId);
      await repository.create(entry);
      expect(await repository.allocateCode()).toBe('KN-000001');
      expect(await repository.allocateCode()).toBe('KN-000002');
      await repository.linkMethods(entry.id, 1, []);
      await repository.createMethod(method, version);
      await repository.linkMethods(entry.id, 1, [version.id]);
      const saved = await repository.get(entry.id, 1, version.id);
      expect(saved).toMatchObject({
        entry: { ...entry, methodIds: [methodId] },
        methods: [method],
        methodVersions: [version],
      });
      expect(await repository.get(entry.id, 99)).toBeNull();
      expect(await repository.get(entry.id, 1, randomUUID())).toBeNull();
      const revised = {
        ...entry,
        revision: 2,
        updatedAt: '2026-10-14T00:00:00.000Z',
        content: { ...entry.content, titleZhHant: '修訂' },
      };
      expect(await repository.addRevision(revised, 1)).toBe(true);
      expect(await repository.addRevision(revised, 1)).toBe(false);
      expect((await repository.get(entry.id))?.entry).toEqual(revised);
      expect((await repository.get(entry.id, 1))?.entry.updatedAt).toBe(
        instant,
      );
      const second = { ...version, id: randomUUID(), revision: 2 };
      expect(
        await repository.addMethodVersion(methodId, version.id, second),
      ).toBe(true);
      expect(
        await repository.addMethodVersion(methodId, version.id, {
          ...second,
          id: randomUUID(),
          revision: 3,
        }),
      ).toBe(false);
      expect(await repository.getMethodVersion(second.id)).toEqual(second);
      const foreign = createKnowledgeRepository(tx, randomUUID());
      expect(await foreign.get(entry.id)).toBeNull();
      expect(await foreign.getMethod(methodId)).toBeNull();
      expect(await foreign.getMethodVersion(version.id)).toBeNull();
      expect(await foreign.addRevision({ ...revised, revision: 3 }, 2)).toBe(
        false,
      );
      expect(
        await foreign.addMethodVersion(methodId, second.id, {
          ...second,
          id: randomUUID(),
          revision: 3,
        }),
      ).toBe(false);
      await expect(foreign.createMethod(method, version)).rejects.toThrow();
      await expect(
        repository.createMethod(method, {
          ...version,
          methodId: randomUUID(),
        }),
      ).rejects.toThrow();
      await expect(
        repository.createMethod(
          { ...method, currentVersionId: randomUUID() },
          version,
        ),
      ).rejects.toThrow();
      await expect(
        foreign.linkMethods(entry.id, 2, [version.id]),
      ).rejects.toThrow();
      await expect(
        repository.linkMethods(entry.id, 2, [randomUUID()]),
      ).rejects.toThrow();
      await expect(
        repository.addMethodVersion(methodId, second.id, {
          ...second,
          methodId: randomUUID(),
        }),
      ).rejects.toThrow();
    });
  });

  it('should hydrate citations and reference images and filter by cited source', async ({
    connection,
  }) => {
    const database = connection;
    const ownerId = randomUUID();
    const sourceId = randomUUID();
    const sourceVersionId = randomUUID();
    const imageId = randomUUID();
    const citation: SourceCitation = {
      id: randomUUID(),
      locator: {
        kind: 'web',
        sourceId,
        sourceVersionId,
        url: 'https://example.invalid/catalog',
        retrievedAt: instant,
        snapshotAssetId: null,
        blockId: null,
        excerptAsRetrieved: null,
      },
      relation: 'background',
      availability: 'link_only',
      verification: 'located',
    };
    const base = knowledgeEntry();
    const entry = {
      ...base,
      content: {
        ...base.content,
        aliases: ['ceramic'],
        kinds: ['material' as const],
        citations: [citation],
        exampleReferenceImageIds: [imageId, randomUUID()],
      },
    };
    await database.db.$transaction(async (tx) => {
      await tx.sources.createMany({
        data: {
          id: sourceId,
          ownerId,
          kind: 'web',
          title: 'Catalog',
          authorStatus: 'unknown',
          access: 'link_only',
        },
      });
      await tx.sourceVersions.createMany({
        data: {
          id: sourceVersionId,
          sourceId,
          ownerId,
          sourceHash: 'a'.repeat(64),
          metadataSnapshot: {},
          capturedAt: instant,
          status: 'registered',
          textIndexStatus: 'registered',
          imageIndexStatus: 'registered',
        },
      });
      await createSourceRepository(tx, ownerId).addCitation(citation);
      await tx.referenceImages.createMany({
        data: {
          id: imageId,
          sourceVersionId,
          locatorId: citation.id,
          externalImageUrl: 'https://example.invalid/image.jpg',
          captionAssociation: 'none',
        },
      });
      const repository = createKnowledgeRepository(tx, ownerId);
      await repository.create(entry);

      const saved = await repository.get(entry.id);
      expect(saved?.entry).toEqual(entry);
      expect(saved?.citations).toEqual([citation]);
      expect(saved?.referenceImages).toMatchObject([
        { id: imageId, locator: citation.locator },
      ]);
      expect(
        (await repository.query({ filters: { sourceIds: [sourceId] } })).items,
      ).toMatchObject([{ id: entry.id, citationCount: 1 }]);
      expect(
        (await repository.query({ filters: { sourceIds: [randomUUID()] } }))
          .items,
      ).toEqual([]);
    });
  });

  it('should paginate stable ordering and reject cursors from a different query', async ({
    connection,
  }) => {
    const database = connection;
    const ownerId = randomUUID();
    const entries = [knowledgeEntry(), knowledgeEntry(), knowledgeEntry()];
    await database.db.$transaction(async (tx) => {
      const repository = createKnowledgeRepository(tx, ownerId);
      for (const entry of entries) {
        await repository.create(entry);
      }
      const first = await repository.query({ limit: 1 });
      const second = await repository.query({
        limit: 2,
        cursor: first.nextCursor!,
      });
      expect([...first.items, ...second.items].map(({ id }) => id)).toEqual(
        entries
          .map(({ id }) => id)
          .sort()
          .reverse(),
      );
      expect(second.nextCursor).toBeNull();
      expect((await repository.query({})).items).toHaveLength(3);
      expect((await repository.query({ q: 'absent' })).items).toEqual([]);
      await expect(
        repository.query({ q: 'changed', cursor: first.nextCursor! }),
      ).rejects.toThrow();
      const decoded = JSON.parse(
        Buffer.from(first.nextCursor!, 'base64url').toString(),
      ) as Record<string, unknown>;
      for (const field of ['updatedAt', 'id']) {
        const cursor = Buffer.from(
          JSON.stringify({ ...decoded, [field]: 1 }),
        ).toString('base64url');
        await expect(repository.query({ cursor })).rejects.toThrow();
      }
      expect(
        (await createKnowledgeRepository(tx, randomUUID()).query({})).items,
      ).toEqual([]);
    });
  });

  it('should match aliases, kinds and all applicability dimensions while excluding unknown context', async ({
    connection,
  }) => {
    const database = connection;
    const ownerId = randomUUID();
    const objectTypeId = randomUUID();
    const materialId = randomUUID();
    const periodId = randomUUID();
    const regionId = randomUUID();
    const base = knowledgeEntry();
    const entry = {
      ...base,
      content: {
        ...base.content,
        aliases: ['porcelain'],
        kinds: ['material' as const],
        applicability: [
          {
            scope: 'specific' as const,
            objectTypeIds: [objectTypeId],
            materialIds: [materialId],
            periodIds: [periodId],
            regionIds: [regionId],
            limits: {
              textZhHant: '限制',
              citationIds: [],
              support: 'needs_source' as const,
            },
          },
        ],
      },
    };
    await database.db.$transaction(async (tx) => {
      const repository = createKnowledgeRepository(tx, ownerId);
      await repository.create(entry);
      await repository.create(knowledgeEntry());
      expect(
        (
          await repository.query({
            q: 'porcelain',
            kinds: ['material'],
            status: 'draft',
          })
        ).items.map(({ id }) => id),
      ).toEqual([entry.id]);
      expect(
        (
          await repository.query({
            filters: {
              objectTypeIds: [objectTypeId],
              materialIds: [materialId],
              periodIds: [periodId],
              regionIds: [regionId],
            },
          })
        ).items.map(({ id }) => id),
      ).toEqual([entry.id]);
      for (const field of [
        'objectTypeIds',
        'materialIds',
        'periodIds',
        'regionIds',
        'sourceIds',
      ]) {
        expect(
          (await repository.query({ filters: { [field]: [randomUUID()] } }))
            .items,
        ).toEqual([]);
      }
      expect(
        (
          await repository.query({ filters: { includeUnknown: false } })
        ).items.map(({ id }) => id),
      ).toEqual([entry.id]);
      expect((await repository.query({ filters: {} })).items).toHaveLength(2);
    });
  });
});

function knowledgeEntry(): KnowledgeEntry {
  const id = randomUUID();

  return {
    id,
    revision: 1,
    createdAt: instant,
    updatedAt: instant,
    displayCode: `KN-${id}`,
    status: 'draft',
    savedBy: null,
    methodIds: [],
    content: {
      titleZhHant: '瓷器',
      aliases: [],
      kinds: [],
      otherKindLabel: null,
      summary: { textZhHant: '摘要', citationIds: [], support: 'needs_source' },
      history: [],
      features: [],
      applicability: [],
      exampleReferenceImageIds: [],
      relatedEntryIds: [],
      citations: [],
    },
  };
}

describe('fn:createKnowledgeRepository v2', () => {
  it('should retain book and web evidence locations and owner-scoped record reference links', async ({
    connection,
  }) => {
    const ownerId = randomUUID();
    const sourceId = randomUUID();
    const versionId = randomUUID();
    const assetId = randomUUID();
    const viewId = randomUUID();
    const pageId = randomUUID();
    const parseRunId = randomUUID();
    const blockId = randomUUID();
    const regionId = randomUUID();
    const citationId = randomUUID();
    const recordId = randomUUID();
    const linkId = randomUUID();
    const excerpt = 'A body observation';
    await connection.db.$transaction(async (tx) => {
      await tx.sources.create({
        data: {
          id: sourceId,
          ownerId,
          kind: 'book_pdf',
          title: 'Book',
          authorStatus: 'unknown',
          access: 'stored_copy',
        },
      });
      await tx.sourceVersions.create({
        data: {
          id: versionId,
          sourceId,
          ownerId,
          sourceHash: 'b'.repeat(64),
          metadataSnapshot: {
            title: 'Book',
            languages: ['en'],
            contributors: [],
          },
          capturedAt: instant,
          status: 'ready',
          textIndexStatus: 'ready',
          imageIndexStatus: 'ready',
        },
      });
      await tx.mediaAssets.create({
        data: {
          id: assetId,
          ownerId,
          sourceVersionId: versionId,
          kind: 'document',
          purpose: 'book_file',
          state: 'ready',
          objectKey: `books/${assetId}`,
          originalFileName: 'book.pdf',
          mimeType: 'application/pdf',
          byteLength: 10,
          sha256: 'c'.repeat(64),
        },
      });
      await tx.canonicalViews.create({
        data: {
          id: viewId,
          originalAssetId: assetId,
          width: 100,
          height: 200,
          coordinateSpace: 'pdf_page_points',
          transformToOriginal: [1, 0, 0, 0, 1, 0, 0, 0, 1],
        },
      });
      await tx.sourcePages.create({
        data: {
          id: pageId,
          sourceVersionId: versionId,
          pageIndex: 0,
          printedPageLabel: '1',
          originalAssetId: assetId,
          canonicalViewId: viewId,
          pdfPageIndex: 0,
        },
      });
      await tx.jobs.create({
        data: {
          id: parseRunId,
          ownerId,
          kind: 'sourceIngestion',
          resourceId: versionId,
          state: 'completed',
          stage: 'parse',
        },
      });
      await tx.parseRuns.create({
        data: {
          id: parseRunId,
          sourceVersionId: versionId,
          jobId: parseRunId,
          provider: 'fixture',
          status: 'completed',
        },
      });
      await tx.sourceBlocks.create({
        data: {
          id: blockId,
          parseRunId,
          pageId,
          rawText: excerpt,
          searchMapping: {},
          ordinal: 0,
        },
      });
      await tx.sourceRegions.create({
        data: {
          id: regionId,
          sourceVersionId: versionId,
          pageId,
          parseRunId,
          kind: 'text',
          geometry: { kind: 'rect', x: 0, y: 0, width: 1, height: 1 },
          rawText: excerpt,
        },
      });
      await tx.sourceLocators.create({
        data: {
          id: citationId,
          sourceId,
          sourceVersionId: versionId,
          kind: 'page',
          pageId,
          pageIndex: 0,
          printedPageLabel: '1',
          canonicalViewId: viewId,
          excerptAsRetrieved: excerpt,
        },
      });
      await tx.citations.create({
        data: {
          id: citationId,
          locatorId: citationId,
          relation: 'supports',
          availability: 'stored',
          verification: 'located',
        },
      });
      await tx.records.create({
        data: {
          id: recordId,
          ownerId,
          code: `R-${recordId}`,
          unitKind: 'single',
        },
      });
      await tx.referenceLinks.create({
        data: {
          id: linkId,
          ownerId,
          targetRecordId: recordId,
          subjectKind: 'source_locator',
          sourceLocatorId: citationId,
          targetIdentityKey: recordId,
          subjectIdentityKey: citationId,
        },
      });
      const citation: KnowledgeContentEnvelopeV2['citations'][number] = {
        id: citationId,
        relation: 'supports',
        availability: 'stored',
        verification: 'located',
        quote: excerpt,
        locator: {
          kind: 'page',
          id: citationId,
          sourceId,
          sourceVersionId: versionId,
          pageId,
          pageIndex: 0,
          printedPageLabel: '1',
          excerpt,
        },
        source: {
          id: sourceId,
          versionId,
          title: 'Book',
          languages: ['en'],
          contributors: [],
        },
      };
      const content = {
        ...knowledgeEnvelope(),
        citations: [citation],
        referenceLinks: [{ id: linkId, targetRecordId: recordId }],
      };
      const repository = createKnowledgeRepository(tx, ownerId);
      expect(await repository.validateV2References(content)).toBe(true);
      await tx.sourceLocators.update({
        where: { id: citationId },
        data: { excerptAsRetrieved: null, regionId },
      });
      expect(await repository.validateV2References(content)).toBe(true);
      await tx.sourceLocators.update({
        where: { id: citationId },
        data: { regionId: null, blockId },
      });
      expect(await repository.validateV2References(content)).toBe(true);
      await tx.sourceLocators.update({
        where: { id: citationId },
        data: { blockId: null },
      });
      expect(await repository.validateV2References(content)).toBe(false);
      await tx.sourceLocators.update({
        where: { id: citationId },
        data: { excerptAsRetrieved: 'Different text' },
      });
      expect(await repository.validateV2References(content)).toBe(false);
      await tx.sourceLocators.update({
        where: { id: citationId },
        data: { excerptAsRetrieved: excerpt },
      });
      if (citation.locator.kind !== 'page') {
        throw new Error('Expected page fixture');
      }
      for (const locator of [
        { ...citation.locator, pageId: randomUUID() },
        { ...citation.locator, pageIndex: 1 },
        { ...citation.locator, printedPageLabel: '2' },
      ]) {
        expect(
          await repository.validateV2References({
            ...content,
            citations: [{ ...citation, locator }],
          }),
        ).toBe(false);
      }
      expect(
        await repository.validateV2References({
          ...content,
          referenceLinks: [
            {
              id: randomUUID(),
              targetRecordId: recordId,
              targetCheckId: randomUUID(),
              targetObservationId: randomUUID(),
              targetAnchorId: randomUUID(),
            },
          ],
        }),
      ).toBe(false);
      const web: KnowledgeContentEnvelopeV2['citations'][number] = {
        ...citation,
        locator: {
          kind: 'web',
          id: citationId,
          sourceId,
          sourceVersionId: versionId,
          url: 'https://book.example/page',
          retrievedAt: instant,
          excerpt,
        },
      };
      expect(
        await repository.validateV2References({ ...content, citations: [web] }),
      ).toBe(false);
      await tx.sourceLocators.update({
        where: { id: citationId },
        data: {
          kind: 'web',
          pageId: null,
          url: 'https://book.example/page',
          retrievedAt: instant,
          blockId,
        },
      });
      expect(
        await repository.validateV2References({ ...content, citations: [web] }),
      ).toBe(true);
      if (web.locator.kind !== 'web') {
        throw new Error('Expected web fixture');
      }
      expect(
        await repository.validateV2References({
          ...content,
          citations: [
            { ...web, locator: { ...web.locator, section: blockId } },
          ],
        }),
      ).toBe(true);
      expect(
        await repository.validateV2References({
          ...content,
          citations: [
            { ...web, locator: { ...web.locator, section: 'wrong-section' } },
          ],
        }),
      ).toBe(false);
      expect(
        await repository.validateV2References({
          ...content,
          citations: [
            {
              ...web,
              locator: { ...web.locator, url: 'https://book.example/wrong' },
            },
          ],
        }),
      ).toBe(false);
      expect(
        await repository.validateV2References({
          ...content,
          citations: [
            {
              ...web,
              locator: {
                ...web.locator,
                retrievedAt: '2026-01-01T00:00:00.000Z',
              },
            },
          ],
        }),
      ).toBe(false);
      expect(
        await repository.validateV2References({
          ...content,
          citations: [
            {
              ...web,
              locator: {
                ...web.locator,
                excerpt: `${excerpt} plus forged addition`,
              },
            },
          ],
        }),
      ).toBe(false);
    });
  });

  it('should propagate unavailable transaction errors instead of disguising them as inaccessible references', async ({
    connection,
  }) => {
    const repository = await connection.db.$transaction(async (tx) =>
      createKnowledgeRepository(tx, randomUUID()),
    );
    await expect(
      repository.validateV2References(knowledgeEnvelope()),
    ).rejects.toThrow();
  });

  it('should pin structured citations, topic projections and source metadata while rejecting evidence substitutions', async ({
    connection,
  }) => {
    const ownerId = randomUUID();
    const sourceId = randomUUID();
    const versionId = randomUUID();
    const citationId = randomUUID();
    const topicId = randomUUID();
    const entryId = randomUUID();
    const base = knowledgeEnvelope();
    const methodEntry = knowledgeEntry();
    const methodId = randomUUID();
    const methodVersionId = randomUUID();
    const imageId = randomUUID();
    const payload = { description: 'A body observation' };
    const valueHash = canonicalHash(payload.description);
    await connection.db.$transaction(async (tx) => {
      await tx.sources.create({
        data: {
          id: sourceId,
          ownerId,
          kind: 'structured_open_data',
          title: 'Catalog',
          authorStatus: 'unknown',
          access: 'link_only',
        },
      });
      await tx.externalObject.create({
        data: {
          id: versionId,
          ownerId,
          sourceId,
          provider: 'museum',
          objectId: '1',
          canonicalRecordUrl: 'https://museum.example/1',
          lastSeenAt: instant,
          status: 'active',
        },
      });
      await tx.sourceVersions.create({
        data: {
          id: versionId,
          sourceId,
          ownerId,
          sourceHash: canonicalHash({
            provider: 'museum',
            objectId: '1',
            payloadHash: canonicalHash(payload),
            schemaVersion: '1',
          }),
          externalObjectId: versionId,
          retrievedAt: instant,
          metadataSnapshot: {
            title: 'Catalog',
            canonicalUrl: 'https://museum.example/1',
            languages: ['en'],
            contributors: [],
          },
          structuredPayload: payload,
          payloadHash: canonicalHash(payload),
          providerSchemaVersion: '1',
          capturedAt: instant,
          status: 'ready',
          textIndexStatus: 'ready',
          imageIndexStatus: 'ready',
        },
      });
      await tx.sourceLocators.create({
        data: {
          id: citationId,
          sourceId,
          sourceVersionId: versionId,
          kind: 'structured',
          provider: 'museum',
          objectId: '1',
          fieldPath: '/description',
          valueHash,
          url: 'https://museum.example/1',
          retrievedAt: instant,
          excerptAsRetrieved: payload.description,
        },
      });
      await tx.citations.create({
        data: {
          id: citationId,
          locatorId: citationId,
          relation: 'supports',
          availability: 'link_only',
          verification: 'located',
        },
      });
      await tx.topic.create({
        data: {
          id: topicId,
          ownerId,
          contentId: `topic:${topicId}`,
          facet: 'material',
        },
      });
      await createKnowledgeRepository(tx, ownerId).create(methodEntry);
      await tx.inspectionMethods.create({
        data: { id: methodId, owningEntryId: methodEntry.id },
      });
      await tx.methodVersions.create({
        data: {
          id: methodVersionId,
          methodId,
          revision: 1,
          definition: {},
          contentHash: 'a'.repeat(64),
        },
      });
      await tx.referenceImages.create({
        data: {
          id: imageId,
          sourceVersionId: versionId,
          locatorId: citationId,
          externalImageUrl: 'https://museum.example/image.jpg',
          sourcePageUrl: 'https://museum.example/1',
          provider: 'museum',
          captionAssociation: 'none',
        },
      });
      const image: KnowledgeContentEnvelopeV2['images'][number] = {
        id: imageId,
        sourceVersionId: versionId,
        imageUrl: 'https://museum.example/image.jpg',
        sourcePageUrl: 'https://museum.example/1',
        provider: 'museum',
        status: 'unchecked',
        locatorId: citationId,
      };
      const citation: KnowledgeContentEnvelopeV2['citations'][number] = {
        id: citationId,
        relation: 'supports',
        availability: 'link_only',
        verification: 'located',
        quote: payload.description,
        locator: {
          kind: 'structured',
          id: citationId,
          sourceId,
          sourceVersionId: versionId,
          provider: 'museum',
          objectId: '1',
          fieldPath: '/description',
          valueHash,
          url: 'https://museum.example/1',
          retrievedAt: instant,
          excerpt: payload.description,
        },
        source: {
          id: sourceId,
          versionId,
          title: 'Catalog',
          canonicalUrl: 'https://museum.example/1',
          languages: ['en'],
          contributors: [],
        },
      };
      const content: KnowledgeContentEnvelopeV2 = {
        ...base,
        images: [image],
        methodIds: [methodId],
        methodVersionIds: [methodVersionId],
        relatedEntryIds: [methodEntry.id],
        titles: [{ language: 'zh-Hant', text: '瓷器' }],
        aliases: [{ language: 'en', text: 'Ceramics' }],
        topics: [
          {
            topicId,
            applicability: 'specific',
            uncertainty: 'Possible attribution',
          },
        ],
        sections: {
          ...base.sections,
          summary: {
            ...base.sections.summary,
            supportState: 'cited',
            citationIds: [citationId],
          },
        },
        claims: base.claims.map((claim) => ({
          ...claim,
          supportState: 'cited',
          citationIds: [citationId],
        })),
        citations: [citation],
      };
      const repository = createKnowledgeRepository(tx, ownerId);
      expect(await repository.validateV2References(content)).toBe(true);
      const { locatorId: _locatorId, ...imageWithoutLocator } = image;
      expect(
        await repository.validateV2References({
          ...content,
          images: [imageWithoutLocator],
        }),
      ).toBe(true);
      const created = await repository.createV2({
        entryId,
        displayCode: `KN-${entryId}`,
        content,
        status: 'draft',
        savedBy: null,
        reviewedBy: null,
        reviewedAt: null,
      });
      expect(created.contentHash).toBe(canonicalHash(content));
      expect(await repository.getV2(entryId, { view: 'saved' })).toBeNull();
      expect(
        await tx.citedClaimCitation.findMany({
          where: { claim: { entryId } },
          select: { citationId: true },
        }),
      ).toEqual([{ citationId }]);
      expect(
        await tx.knowledgeRevisionTopic.findMany({
          where: { entryId },
          select: { topicId: true, applicability: true, uncertainty: true },
        }),
      ).toEqual(content.topics);
      expect(
        await tx.knowledgeRevisionMethods.findMany({
          where: { entryId },
          select: { methodId: true, methodVersionId: true },
        }),
      ).toEqual([{ methodId, methodVersionId }]);
      for (const invalidImage of [
        { ...image, id: randomUUID() },
        { ...image, sourceVersionId: randomUUID() },
        { ...image, imageUrl: 'https://museum.example/wrong.jpg' },
        { ...image, sourcePageUrl: 'https://museum.example/wrong' },
        { ...image, provider: 'other' },
        { ...image, providerImageId: 'other' },
        { ...image, width: 200 },
        { ...image, height: 200 },
        { ...image, locatorId: randomUUID() },
        {
          ...image,
          observedRights: {
            name: 'PDM',
            observedAt: instant,
            evidenceUrl: 'https://museum.example/rights',
          },
        },
      ]) {
        expect(
          await repository.validateV2References({
            ...content,
            images: [invalidImage],
          }),
        ).toBe(false);
      }
      for (const invalidCitation of [
        { ...citation, id: randomUUID() },
        { ...citation, relation: 'background' as const },
        { ...citation, availability: 'unavailable' as const },
        { ...citation, verification: 'needs_review' as const },
        { ...citation, quote: 'Invented quotation' },
        { ...citation, source: { ...citation.source, title: 'Forged title' } },
        {
          ...citation,
          source: {
            ...citation.source,
            canonicalUrl: 'https://museum.example/other',
          },
        },
        {
          ...citation,
          locator: { ...citation.locator, sourceId: randomUUID() },
        },
        {
          ...citation,
          locator: { ...citation.locator, sourceVersionId: randomUUID() },
        },
      ]) {
        expect(
          await repository.validateV2References({
            ...content,
            citations: [invalidCitation],
          }),
        ).toBe(false);
      }
      expect(
        await repository.validateV2References({
          ...content,
          topics: [{ topicId: randomUUID(), applicability: 'general' }],
        }),
      ).toBe(false);
      expect(
        await repository.validateV2References({
          ...content,
          methodIds: [randomUUID()],
        }),
      ).toBe(false);
      expect(
        await repository.validateV2References({
          ...content,
          relatedEntryIds: [randomUUID()],
        }),
      ).toBe(false);
      expect(
        await repository.validateV2References({
          ...content,
          methodVersionIds: [randomUUID()],
        }),
      ).toBe(false);
      expect(
        await repository.validateV2References({
          ...content,
          claims: content.claims.map((claim) => ({
            ...claim,
            variants: claim.variants.map((variant) => ({
              ...variant,
              sourceTextHash: 'f'.repeat(64),
            })),
          })),
        }),
      ).toBe(false);
    });
  });

  it('should reject another owner citation chain before appending an envelope or projections', async ({
    connection,
  }) => {
    const ownerId = randomUUID();
    const sourceId = randomUUID();
    const sourceVersionId = randomUUID();
    const citationId = randomUUID();
    const entryId = randomUUID();
    const content = knowledgeEnvelope();
    await expect(
      connection.db.$transaction(async (tx) => {
        await tx.sources.create({
          data: {
            id: sourceId,
            ownerId: randomUUID(),
            kind: 'web',
            title: 'Foreign catalog',
            authorStatus: 'unknown',
            access: 'link_only',
          },
        });
        await tx.sourceVersions.create({
          data: {
            id: sourceVersionId,
            sourceId,
            ownerId,
            sourceHash: 'c'.repeat(64),
            metadataSnapshot: {},
            capturedAt: instant,
            status: 'registered',
            textIndexStatus: 'registered',
            imageIndexStatus: 'registered',
          },
        });
        await tx.sourceLocators.create({
          data: {
            id: citationId,
            sourceId,
            sourceVersionId,
            kind: 'web',
            url: 'https://museum.example/object',
            retrievedAt: instant,
            excerptAsRetrieved: 'A body observation',
          },
        });
        await tx.citations.create({
          data: {
            id: citationId,
            locatorId: citationId,
            relation: 'supports',
            availability: 'link_only',
            verification: 'located',
          },
        });
        const citedContent: KnowledgeContentEnvelopeV2 = {
          ...content,
          sections: {
            ...content.sections,
            summary: {
              ...content.sections.summary,
              supportState: 'cited',
              citationIds: [citationId],
            },
          },
          claims: content.claims.map((claim) => ({
            ...claim,
            supportState: 'cited',
            citationIds: [citationId],
          })),
          citations: [
            {
              id: citationId,
              relation: 'supports',
              availability: 'link_only',
              verification: 'located',
              quote: 'A body observation',
              locator: {
                id: citationId,
                kind: 'web',
                sourceId,
                sourceVersionId,
                url: 'https://museum.example/object',
                retrievedAt: instant,
                section: 'description',
                excerpt: 'A body observation',
              },
              source: {
                id: sourceId,
                versionId: sourceVersionId,
                title: 'Foreign catalog',
                languages: ['en'],
                contributors: [],
              },
            },
          ],
        };
        await createKnowledgeRepository(tx, ownerId).createV2({
          entryId,
          displayCode: `KN-${entryId}`,
          content: citedContent,
          status: 'draft',
          savedBy: null,
          reviewedBy: null,
          reviewedAt: null,
        });
      }),
    ).rejects.toThrow();
    expect(
      await connection.db.knowledgeEntries.findUnique({
        where: { id: entryId },
      }),
    ).toBeNull();
    expect(await connection.db.citedClaim.count({ where: { entryId } })).toBe(
      0,
    );
  });

  it('should atomically preserve the canonical envelope, projections, saved head and exact historical reads', async ({
    connection,
  }) => {
    const ownerId = randomUUID();
    const entryId = randomUUID();
    const content = knowledgeEnvelope();
    await connection.db.$transaction(async (tx) => {
      const repository = createKnowledgeRepository(tx, ownerId);
      const created = await repository.createV2({
        entryId,
        displayCode: `KN-${entryId}`,
        content,
        status: 'saved',
        savedBy: 'collector',
        reviewedBy: null,
        reviewedAt: null,
      });
      expect(created).toMatchObject({
        id: entryId,
        revision: 1,
        status: 'saved',
        savedBy: 'collector',
        content,
      });
      const claimRows = await tx.citedClaim.findMany({
        where: { entryId, revision: 1 },
      });
      expect(claimRows).toMatchObject([
        {
          claimKey: 'body',
          originalText: 'A body observation',
          originalLanguage: 'en',
          supportState: 'needs_source',
          reviewState: 'pending',
          scope: {},
          qualifiers: {},
        },
      ]);
      const variants = await tx.languageVariant.findMany({
        where: { claimId: claimRows[0]!.id },
      });
      expect(variants).toMatchObject([
        {
          language: 'en',
          kind: 'original',
          text: 'A body observation',
          sourceTextHash: content.claims[0]!.variants[0]!.sourceTextHash,
        },
      ]);
      const rebuilt = projectKnowledge(
        { ownerId, entryId, revision: 1 },
        created.content,
      );
      expect(claimRows.map(({ createdAt: _createdAt, ...row }) => row)).toEqual(
        rebuilt.claims,
      );
      expect(variants.map(({ createdAt: _createdAt, ...row }) => row)).toEqual(
        rebuilt.variants,
      );
      expect(await auditKnowledge(tx)).toMatchObject({ projectionGaps: 0 });
      await tx.languageVariant.deleteMany({
        where: { claimId: claimRows[0]!.id },
      });
      expect(await auditKnowledge(tx)).toMatchObject({ projectionGaps: 1 });
      await tx.languageVariant.createMany({ data: variants });
      await tx.knowledgeRevisions.update({
        where: { entryId_revision: { entryId, revision: 1 } },
        data: { content: {} },
      });
      expect(await auditKnowledge(tx)).toMatchObject({ projectionGaps: 1 });
      await tx.knowledgeRevisions.update({
        where: { entryId_revision: { entryId, revision: 1 } },
        data: { content: jsonValue(content) },
      });

      const revisedContent = {
        ...content,
        titles: [{ language: 'en', text: 'Updated working title' }],
      };
      const updated = await repository.addRevisionV2({
        entryId,
        expectedRevision: 1,
        content: revisedContent,
        status: 'draft',
        savedBy: null,
        reviewedBy: null,
        reviewedAt: null,
      });
      expect(updated).toMatchObject({
        revision: 2,
        status: 'draft',
        savedBy: null,
        content: revisedContent,
      });
      expect(await repository.getV2(entryId, { view: 'saved' })).toEqual(
        created,
      );
      expect(
        await repository.getV2(entryId, { view: 'revision', revision: 1 }),
      ).toEqual(created);
      expect(await repository.getV2(entryId, { view: 'working' })).toEqual(
        updated,
      );
      expect(await repository.getV2(entryId, {})).toEqual(updated);
      const pendingTranslation = {
        language: 'zh-Hant',
        kind: 'translation' as const,
        text: '胎體',
        method: 'machine' as const,
        sourceTextHash: 'a'.repeat(64),
        review: { state: 'pending' as const },
      };
      const translated = {
        ...content,
        claims: content.claims.map((claim) => ({
          ...claim,
          variants: [pendingTranslation],
        })),
      };
      expect(await repository.validateV2References(translated)).toBe(true);
      expect(
        await repository.validateV2References({
          ...translated,
          claims: translated.claims.map((claim) => ({
            ...claim,
            variants: claim.variants.map((variant) => ({
              ...variant,
              review: { state: 'reviewed', actor: 'collector', at: instant },
            })),
          })),
        }),
      ).toBe(false);

      expect(await repository.getV2(entryId)).toEqual(updated);
      expect((await repository.query({ filters: {} })).items).toMatchObject([
        { id: entryId },
      ]);
      expect(await repository.getV2Hash(entryId, { view: 'saved' })).toBe(
        created.contentHash,
      );
      expect(await repository.getV2Hash(randomUUID(), {})).toBeNull();
      expect(
        await repository.getV2(entryId, { view: 'revision', revision: 99 }),
      ).toBeNull();
      expect(
        await createKnowledgeRepository(tx, randomUUID()).getV2(entryId, {
          view: 'saved',
        }),
      ).toBeNull();
      expect(
        await repository.addRevisionV2({
          entryId,
          expectedRevision: 1,
          content,
          status: 'saved',
          savedBy: 'collector',
          reviewedBy: null,
          reviewedAt: null,
        }),
      ).toBeNull();
      expect(await tx.knowledgeRevisions.count({ where: { entryId } })).toBe(2);
      expect(
        await tx.citedClaim.findMany({ where: { entryId, revision: 1 } }),
      ).toEqual(claimRows);
      expect(
        await tx.languageVariant.findMany({
          where: { claimId: claimRows[0]!.id },
        }),
      ).toEqual(variants);
      expect(
        await tx.knowledgeEntries.findUnique({ where: { id: entryId } }),
      ).toMatchObject({ currentRevision: 2, latestSavedRevision: 1 });
    });
  });
});

function knowledgeEnvelope(): KnowledgeContentEnvelopeV2 {
  const originalText = 'A body observation';

  return {
    contentSchemaVersion: 2,
    entryType: 'concept',
    origin: 'collector',
    titles: [{ language: 'en', text: 'Porcelain body' }],
    aliases: [],
    sections: {
      summary: {
        claimKey: 'body',
        text: originalText,
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
        claimKey: 'body',
        section: 'summary',
        ordinal: 0,
        originalText,
        originalLanguage: 'en',
        statementType: 'observation',
        scope: {},
        qualifiers: {},
        supportState: 'needs_source',
        citationIds: [],
        review: { state: 'pending' },
        variants: [
          {
            language: 'en',
            kind: 'original',
            text: originalText,
            method: 'original',
            sourceTextHash: createHash('sha256')
              .update(originalText)
              .digest('hex'),
            review: { state: 'pending' },
          },
        ],
      },
    ],
    topics: [],
    citations: [],
    images: [],
    methodIds: [],
    relatedEntryIds: [],
    editorialReview: { state: 'pending' },
  };
}

describe('fn:auditKnowledge', () => {
  it('should report invalid drafts and missing saved pointers without rewriting saved content, then apply idempotently', async ({
    connection,
  }) => {
    const entryId = randomUUID();
    const content = { legacy: 'preserved exactly' };
    await connection.db.$transaction(async (tx) => {
      await tx.knowledgeEntries.create({
        data: {
          id: entryId,
          ownerId: randomUUID(),
          displayCode: `KN-${entryId}`,
          currentRevision: 3,
        },
      });
      await tx.knowledgeRevisions.createMany({
        data: [1, 2, 3].map((revision) => ({
          entryId,
          revision,
          status: revision === 3 ? 'draft' : 'saved',
          savedBy: 'collector',
          titleZhHant: 'Legacy title',
          summaryZhHant: 'Legacy summary',
          content,
          contentHash: String(revision).repeat(64),
        })),
      });
      const before = await tx.knowledgeRevisions.findMany({
        where: { entryId },
        orderBy: { revision: 'asc' },
      });

      expect(await auditKnowledge(tx)).toMatchObject({
        invalidDrafts: 1,
        missingSavedPointers: 1,
        projectionGaps: 0,
      });
      expect(
        await tx.knowledgeRevisions.findMany({
          where: { entryId },
          orderBy: { revision: 'asc' },
        }),
      ).toEqual(before);
      const applied = await auditKnowledge(tx, { apply: true });
      expect(applied).toMatchObject({
        invalidDrafts: 1,
        missingSavedPointers: 1,
        projectionGaps: 0,
      });
      expect(applied.lines.some((line) => line.includes(entryId))).toBe(true);
      expect(
        await tx.knowledgeEntries.findUnique({ where: { id: entryId } }),
      ).toMatchObject({
        currentRevision: 3,
        latestSavedRevision: 2,
      });
      expect(
        await tx.knowledgeRevisions.findMany({
          where: { entryId },
          orderBy: { revision: 'asc' },
        }),
      ).toEqual(
        before.map((row) =>
          row.revision === 3 ? { ...row, savedBy: null } : row,
        ),
      );
      expect(await auditKnowledge(tx, { apply: true })).toMatchObject({
        invalidDrafts: 0,
        missingSavedPointers: 0,
        projectionGaps: 0,
      });
    });
  });
});

describe('fn:runKnowledgeAudit', () => {
  it('should emit dry-run before applying repairs and leave a clean idempotent reapply', async ({
    connection,
  }) => {
    const entryId = randomUUID();
    await connection.db.knowledgeEntries.create({
      data: {
        id: entryId,
        ownerId: randomUUID(),
        displayCode: `KN-${entryId}`,
        currentRevision: 1,
      },
    });
    await connection.db.knowledgeRevisions.create({
      data: {
        entryId,
        revision: 1,
        status: 'draft',
        savedBy: 'collector',
        titleZhHant: 'Legacy',
        summaryZhHant: 'Legacy',
        content: {},
        contentHash: 'd'.repeat(64),
      },
    });
    const dryLines: string[] = [];
    await runKnowledgeAudit([], connection.url, (line) => dryLines.push(line));
    expect(dryLines.map((line) => JSON.parse(line))).toMatchObject([
      { mode: 'dry-run', invalidDrafts: 1 },
    ]);
    expect(
      await connection.db.knowledgeRevisions.findUnique({
        where: { entryId_revision: { entryId, revision: 1 } },
      }),
    ).toMatchObject({ savedBy: 'collector' });
    const appliedLines: string[] = [];
    await runKnowledgeAudit(['--apply'], connection.url, (line) =>
      appliedLines.push(line),
    );
    expect(appliedLines.map((line) => JSON.parse(line))).toMatchObject([
      { mode: 'dry-run', invalidDrafts: 1 },
      { mode: 'apply', invalidDrafts: 1 },
    ]);
    const repeatedLines: string[] = [];
    await runKnowledgeAudit(['--apply'], connection.url, (line) =>
      repeatedLines.push(line),
    );
    expect(repeatedLines.map((line) => JSON.parse(line))).toMatchObject([
      { mode: 'dry-run', invalidDrafts: 0 },
      { mode: 'apply', invalidDrafts: 0 },
    ]);
  });

  it('should reject unsupported or repeated command options before opening a connection', async ({
    connection,
  }) => {
    await expect(
      runKnowledgeAudit(['--unknown'], connection.url, () => {}),
    ).rejects.toThrow(TypeError);
    await expect(
      runKnowledgeAudit(['--apply', '--apply'], connection.url, () => {}),
    ).rejects.toThrow(TypeError);
  });
});
