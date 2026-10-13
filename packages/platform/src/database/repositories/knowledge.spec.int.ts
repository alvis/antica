import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { referenceImages, sources, sourceVersions } from '../schema/index.js';

import { createIsolatedDatabase } from '../spec/fixtures/isolated-database.js';

import { createKnowledgeRepository } from './knowledge.js';
import { createSourceRepository } from './sources.js';

import type {
  InspectionMethodVersion,
  KnowledgeEntry,
  SourceCitation,
} from '@antica/domain';

const instant = '2026-10-13T00:00:00.000Z';

describe('fn:createKnowledgeRepository', () => {
  it('should preserve revisions, linked method versions and ownership boundaries', async () => {
    const database = await createIsolatedDatabase();
    const ownerId = database.ownerId;
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
    try {
      await database.db.transaction(async (tx) => {
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
    } finally {
      await database.close();
    }
  });

  it('should hydrate citations and reference images and filter by cited source', async () => {
    const database = await createIsolatedDatabase();
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
    try {
      await database.db.transaction(async (tx) => {
        await tx.insert(sources).values({
          id: sourceId,
          ownerId: database.ownerId,
          kind: 'web',
          title: 'Catalog',
          authorStatus: 'unknown',
          access: 'link_only',
        });
        await tx.insert(sourceVersions).values({
          id: sourceVersionId,
          sourceId,
          ownerId: database.ownerId,
          sourceHash: 'a'.repeat(64),
          metadataSnapshot: {},
          capturedAt: instant,
          status: 'registered',
          textIndexStatus: 'registered',
          imageIndexStatus: 'registered',
        });
        await createSourceRepository(tx, database.ownerId).addCitation(
          citation,
        );
        await tx.insert(referenceImages).values({
          id: imageId,
          sourceVersionId,
          locatorId: citation.id,
          externalImageUrl: 'https://example.invalid/image.jpg',
          captionAssociation: 'none',
        });
        const repository = createKnowledgeRepository(tx, database.ownerId);
        await repository.create(entry);

        const saved = await repository.get(entry.id);
        expect(saved?.entry).toEqual(entry);
        expect(saved?.citations).toEqual([citation]);
        expect(saved?.referenceImages).toMatchObject([
          { id: imageId, locator: citation.locator },
        ]);
        expect(
          (await repository.query({ filters: { sourceIds: [sourceId] } }))
            .items,
        ).toMatchObject([{ id: entry.id, citationCount: 1 }]);
        expect(
          (await repository.query({ filters: { sourceIds: [randomUUID()] } }))
            .items,
        ).toEqual([]);
      });
    } finally {
      await database.close();
    }
  });

  it('should paginate stable ordering and reject cursors from a different query', async () => {
    const database = await createIsolatedDatabase();
    const entries = [knowledgeEntry(), knowledgeEntry(), knowledgeEntry()];
    try {
      await database.db.transaction(async (tx) => {
        const repository = createKnowledgeRepository(tx, database.ownerId);
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
    } finally {
      await database.close();
    }
  });

  it('should match aliases, kinds and all applicability dimensions while excluding unknown context', async () => {
    const database = await createIsolatedDatabase();
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
    try {
      await database.db.transaction(async (tx) => {
        const repository = createKnowledgeRepository(tx, database.ownerId);
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
    } finally {
      await database.close();
    }
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
