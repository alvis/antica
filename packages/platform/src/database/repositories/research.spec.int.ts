import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { createDatabase } from '../connection.js';
import {
  indexVersions,
  jobs,
  mediaAssets,
  noteParagraphs,
  records,
  referenceLinks,
  sources,
} from '../schema/index.js';
import { createIsolatedDatabase } from '../spec/fixtures/isolated-database.js';

import { createResearchRepository } from './research.js';

import type { RetrievalSnapshot } from '@antica/application/ports';
import type {
  Note,
  ReferenceLink,
  ResearchDetail,
  ResearchRequest,
} from '@antica/contracts';
import type { SourceCitation } from '@antica/domain';

import type { Transaction } from '../transaction.js';

const now = '2026-10-13T00:00:00.000Z';

describe('fn:createResearchRepository', () => {
  it('should omit a note deleted after listing under read committed isolation', async () => {
    const database = await createIsolatedDatabase();
    const reader = createDatabase({ url: database.url, maxConnections: 1 });
    const noteId = randomUUID();
    try {
      const research = await database.db.transaction(async (tx) => {
        const detail = await createResearch(tx, database.ownerId);
        await createResearchRepository(tx, database.ownerId).addNote({
          id: noteId,
          researchId: detail.researchId,
          titleZhHant: 'Temporary note',
          paragraphs: [],
          citations: [],
          recordId: null,
          entryId: null,
          savedBy: 'collector',
          savedAt: now,
        });

        return detail;
      });
      reader.db.$client.options.debug = (_connection, query): void => {
        if (
          query.includes('from "notes"') &&
          query.includes('"notes"."id" =')
        ) {
          execFileSync(
            process.execPath,
            [
              '--input-type=module',
              '-e',
              'import postgres from "postgres"; const client = postgres(process.argv[1], { max: 1, prepare: false }); try { await client.unsafe("delete from notes where id = $1", [process.argv[2]]); } finally { await client.end(); }',
              database.url,
              noteId,
            ],
            { cwd: new URL('../../../', import.meta.url), timeout: 10_000 },
          );
        }
      };

      const result = await reader.db.transaction(async (tx) =>
        createResearchRepository(tx, database.ownerId).get(research.researchId),
      );

      expect(result).toMatchObject({
        researchId: research.researchId,
        notes: [],
      });
    } finally {
      await reader.close();
      await database.close();
    }
  });
  it('should preserve durable job states and reject reads outside the owner', async () => {
    const database = await createIsolatedDatabase();
    try {
      await database.db.transaction(async (tx) => {
        const repository = createResearchRepository(tx, database.ownerId);
        const detail = await createResearch(tx, database.ownerId);
        expect(
          await createResearchRepository(tx, randomUUID()).get(
            detail.researchId,
          ),
        ).toBeNull();
        for (const state of [
          'queued',
          'running',
          'waiting',
          'succeeded',
          'partial',
          'failed',
        ] as const) {
          const error = {
            code: 'provider_unavailable',
            message: 'Unavailable',
            retryable: true,
          };
          await tx
            .update(jobs)
            .set({
              state,
              stage: 'retrieve',
              completedAt: now,
              result: { incompleteStages: ['web'] },
              error,
            })
            .where(eq(jobs.id, detail.jobId));
          const expected =
            state === 'queued'
              ? { kind: state }
              : state === 'running' || state === 'waiting'
                ? { kind: state, stage: 'retrieve' }
                : state === 'failed'
                  ? { kind: state, error }
                  : state === 'partial'
                    ? {
                        kind: state,
                        completedAt: now,
                        incompleteStages: ['web'],
                      }
                    : { kind: state, completedAt: now };
          expect((await repository.get(detail.researchId))?.state).toEqual(
            expected,
          );
        }
        await tx
          .update(jobs)
          .set({ state: 'partial', result: null })
          .where(eq(jobs.id, detail.jobId));
        expect((await repository.get(detail.researchId))?.state).toEqual({
          kind: 'partial',
          completedAt: now,
          incompleteStages: [],
        });
      });
    } finally {
      await database.close();
    }
  });

  it('should freeze draft revisions and persist cited notes with their original source versions', async () => {
    const database = await createIsolatedDatabase();
    try {
      await database.db.transaction(async (tx) => {
        const repository = createResearchRepository(tx, database.ownerId);
        const initial = await createResearch(tx, database.ownerId);
        await repository.saveDetail(initial);
        const citation = webCitation();
        const paragraph = {
          textZhHant: '目錄證據',
          citationIds: [citation.id],
          support: 'cited' as const,
        };
        const detail: ResearchDetail = {
          ...initial,
          draft: {
            revision: 1,
            titleZhHant: '研究',
            paragraphs: [paragraph],
            citations: [citation],
            unresolvedQuestionsZhHant: [],
          },
        };
        await repository.saveDetail(detail);
        await repository.saveDetail(detail);
        const secondCitation = { ...citation, id: randomUUID() };
        await repository.saveDetail({
          ...detail,
          draft: {
            ...detail.draft!,
            revision: 2,
            citations: [citation, secondCitation],
          },
        });
        await repository.saveDetail({
          ...detail,
          draft: { ...detail.draft!, revision: 3 },
        });
        const cited = {
          ...detail,
          sourceIds: [citation.locator.sourceId],
          warningsZhHant: ['待確認'],
        };
        await repository.saveDetail(cited);
        expect(await repository.get(detail.researchId)).toMatchObject({
          sourceIds: cited.sourceIds,
          draft: { ...detail.draft, revision: 3 },
          warningsZhHant: cited.warningsZhHant,
        });
        await expect(
          repository.saveDetail({
            ...detail,
            draft: { ...detail.draft!, titleZhHant: '改寫' },
          }),
        ).rejects.toThrow();
        const note: Note = {
          id: randomUUID(),
          researchId: detail.researchId,
          titleZhHant: '保存',
          paragraphs: [paragraph],
          citations: [citation],
          recordId: null,
          entryId: null,
          savedBy: 'collector',
          savedAt: now,
        };
        await repository.addNote(note);
        expect((await repository.get(detail.researchId))?.notes).toEqual([
          note,
        ]);
        await tx
          .update(noteParagraphs)
          .set({ content: null })
          .where(eq(noteParagraphs.noteId, note.id));
        expect(
          (await repository.get(detail.researchId))?.notes[0]?.paragraphs,
        ).toEqual([
          {
            textZhHant: paragraph.textZhHant,
            citationIds: [],
            support: 'needs_source',
          },
        ]);
        const uncited = await createResearch(tx, database.ownerId);
        const empty: Note = {
          ...note,
          id: randomUUID(),
          researchId: uncited.researchId,
          paragraphs: [],
          citations: [],
        };
        await repository.addNote(empty);
        expect((await repository.get(uncited.researchId))?.notes).toEqual([
          empty,
        ]);
        const foreign = createResearchRepository(tx, randomUUID());
        await expect(foreign.saveDetail(detail)).rejects.toThrow();
        await expect(
          foreign.addNote({ ...note, id: randomUUID() }),
        ).rejects.toThrow();
      });
    } finally {
      await database.close();
    }
  });

  it('should reject unavailable requested sources and select the current owned version', async () => {
    const database = await createIsolatedDatabase();
    try {
      const missing = randomUUID();
      await expect(
        database.db.transaction(async (tx) =>
          createResearch(tx, database.ownerId, [missing]),
        ),
      ).rejects.toThrow();
      await database.db.insert(sources).values({
        id: missing,
        ownerId: database.ownerId,
        kind: 'web',
        title: 'Pending source',
        authorStatus: 'unknown',
        access: 'link_only',
      });
      await expect(
        database.db.transaction(async (tx) =>
          createResearch(tx, database.ownerId, [missing]),
        ),
      ).rejects.toThrow();
      await database.db.transaction(async (tx) => {
        const repository = createResearchRepository(tx, database.ownerId);
        const detail = await createResearch(tx, database.ownerId);
        const citation = webCitation();
        await repository.saveDetail({
          ...detail,
          draft: {
            revision: 1,
            titleZhHant: '研究',
            paragraphs: [],
            citations: [citation],
            unresolvedQuestionsZhHant: [],
          },
        });
        const selected = await createResearch(tx, database.ownerId, [
          citation.locator.sourceId,
        ]);
        expect(selected.request.sourceIds).toEqual([citation.locator.sourceId]);
      });
    } finally {
      await database.close();
    }
  });

  it('should replay frozen retrieval snapshots and reject content or index identity changes', async () => {
    const database = await createIsolatedDatabase();
    try {
      await database.db.transaction(async (tx) => {
        const repository = createResearchRepository(tx, database.ownerId);
        const detail = await createResearch(tx, database.ownerId);
        const snapshot: RetrievalSnapshot = {
          id: detail.researchId,
          index: {
            indexVersion: 'development-index',
            embeddingModelId: 'local-model',
            dimensions: 3,
          },
          citations: [],
          text: [],
          methods: [],
          createdAt: now,
        };
        expect(
          await repository.getRetrievalSnapshot(detail.researchId),
        ).toBeNull();
        await repository.saveRetrievalSnapshot(snapshot);
        await repository.saveRetrievalSnapshot(snapshot);
        expect(
          await repository.getRetrievalSnapshot(detail.researchId),
        ).toEqual(snapshot);
        await expect(
          repository.saveRetrievalSnapshot({
            ...snapshot,
            createdAt: '2026-10-14T00:00:00.000Z',
          }),
        ).rejects.toThrow();
        const foreign = createResearchRepository(tx, randomUUID());
        expect(
          await foreign.getRetrievalSnapshot(detail.researchId),
        ).toBeNull();
        await expect(foreign.saveRetrievalSnapshot(snapshot)).rejects.toThrow();
        const another = await createResearch(tx, database.ownerId);
        const indexId = randomUUID();
        await repository.saveRetrievalSnapshot({
          ...snapshot,
          id: another.researchId,
          index: { ...snapshot.index, indexVersion: indexId },
        });
        expect(
          (await repository.getRetrievalSnapshot(another.researchId))?.index
            .indexVersion,
        ).toBe(indexId);
        for (const change of [
          { kind: 'image' },
          { embeddingModelId: 'different' },
          { dimensions: 4 },
        ]) {
          const conflictId = randomUUID();
          const conflictRun = await createResearch(tx, database.ownerId);
          await tx.insert(indexVersions).values({
            id: conflictId,
            kind: 'text',
            embeddingModelId: 'local-model',
            dimensions: 3,
            status: 'active',
            ...change,
          });
          await expect(
            repository.saveRetrievalSnapshot({
              ...snapshot,
              id: conflictRun.researchId,
              index: { ...snapshot.index, indexVersion: conflictId },
            }),
          ).rejects.toThrow();
        }
      });
    } finally {
      await database.close();
    }
  });

  it('should paginate source references deterministically and honor target and owner filters', async () => {
    const database = await createIsolatedDatabase();
    try {
      await database.db.transaction(async (tx) => {
        const repository = createResearchRepository(tx, database.ownerId);
        const detail = await createResearch(tx, database.ownerId);
        const citation = webCitation();
        await repository.saveDetail({
          ...detail,
          draft: {
            revision: 1,
            titleZhHant: '研究',
            paragraphs: [],
            citations: [citation],
            unresolvedQuestionsZhHant: [],
          },
        });
        const recordId = randomUUID();
        const checkId = randomUUID();
        const observationId = randomUUID();
        await tx.insert(records).values({
          id: recordId,
          ownerId: database.ownerId,
          code: 'AC-000001',
          unitKind: 'single',
        });
        const ids = Array.from({ length: 3 }, () => randomUUID())
          .sort()
          .reverse();
        const links: ReferenceLink[] = ids.map((id, index) => ({
          id,
          target: {
            recordId,
            checkId: index === 0 ? checkId : null,
            observationId: index === 0 ? observationId : null,
            evidenceAnchorId: null,
          },
          reference: {
            kind: 'source',
            locator: citation.locator,
            referenceImageId: null,
          },
          comparisonId: null,
          noteZhHant: '參考',
          createdAt: now,
          versions: {
            recordRevision: 1,
            analysisInputVersion: 1,
            evidenceVersion: 1,
          },
        }));
        for (const link of links) {
          await repository.addReference(link, link.id);
        }
        expect(await repository.getReference(ids[0]!)).toEqual(links[0]);
        expect(await repository.findReference(recordId, ids[0]!)).toEqual(
          links[0],
        );
        expect(await repository.findReference(recordId, 'missing')).toBeNull();
        expect(await repository.getReference(randomUUID())).toBeNull();
        const first = await repository.queryReferences(recordId, { limit: 1 });
        const second = await repository.queryReferences(recordId, {
          limit: 2,
          cursor: first.nextCursor!,
        });
        expect([...first.items, ...second.items]).toEqual(links);
        expect(second.nextCursor).toBeNull();
        expect(
          (
            await repository.queryReferences(recordId, {
              checkId,
              observationId,
            })
          ).items,
        ).toEqual([links[0]]);
        expect(
          (
            await createResearchRepository(tx, randomUUID()).queryReferences(
              recordId,
              {},
            )
          ).items,
        ).toEqual([]);
        const assetId = randomUUID();
        await tx.insert(mediaAssets).values({
          id: assetId,
          ownerId: database.ownerId,
          recordId,
          kind: 'photo',
          purpose: 'object',
          state: 'ready',
          objectKey: `originals/${assetId}`,
          originalFileName: 'reference.jpg',
          mimeType: 'image/jpeg',
          byteLength: 3,
          sha256: 'a'.repeat(64),
        });
        const collection: ReferenceLink = {
          ...links[0]!,
          id: randomUUID(),
          reference: {
            kind: 'collection',
            recordId,
            originalAssetId: assetId,
            evidenceAnchorId: null,
          },
        };
        await repository.addReference(collection, 'collection');
        expect(await repository.getReference(collection.id)).toEqual(
          collection,
        );
        await tx
          .update(referenceLinks)
          .set({ note: null })
          .where(eq(referenceLinks.id, collection.id));
        expect(await repository.getReference(collection.id)).toEqual({
          ...collection,
          noteZhHant: '',
        });

        const foreignOwner = randomUUID();
        const foreignRun = await createResearch(tx, foreignOwner);
        const foreignCitation = webCitation();
        await createResearchRepository(tx, foreignOwner).saveDetail({
          ...foreignRun,
          draft: {
            revision: 1,
            titleZhHant: 'Private research',
            paragraphs: [],
            citations: [foreignCitation],
            unresolvedQuestionsZhHant: [],
          },
        });
        const inaccessible: ReferenceLink = {
          ...links[0]!,
          id: randomUUID(),
          reference: {
            kind: 'source',
            locator: foreignCitation.locator,
            referenceImageId: null,
          },
        };
        await repository.addReference(inaccessible, 'foreign-source');
        expect(await repository.getReference(inaccessible.id)).toBeNull();
        expect(
          (await repository.queryReferences(recordId, {})).items.map(
            (item) => item.id,
          ),
        ).not.toContain(inaccessible.id);

        for (const cursor of [
          { id: 1, createdAt: now },
          { id: ids[0], createdAt: 1 },
        ]) {
          await expect(
            repository.queryReferences(recordId, {
              cursor: Buffer.from(JSON.stringify(cursor)).toString('base64url'),
            }),
          ).rejects.toThrow();
        }
      });
    } finally {
      await database.close();
    }
  });
});

async function createResearch(
  tx: Transaction,
  ownerId: string,
  sourceIds: string[] = [],
): Promise<ResearchDetail> {
  const id = randomUUID();
  const jobId = randomUUID();
  await tx.insert(jobs).values({
    id: jobId,
    ownerId,
    kind: 'research',
    resourceId: id,
    state: 'queued',
    stage: 'retrieve',
  });
  const request: ResearchRequest = {
    requestKey: randomUUID(),
    instructionZhHant: '研究釉面',
    scope: 'curated_only',
    recordId: null,
    entryId: null,
    sourceIds,
    preferNamedAuthors: true,
  };
  const repository = createResearchRepository(tx, ownerId);
  await repository.create(id, jobId, request);

  return (await repository.get(id))!;
}

function webCitation(): SourceCitation {
  return {
    id: randomUUID(),
    locator: {
      kind: 'web',
      sourceId: randomUUID(),
      sourceVersionId: randomUUID(),
      url: 'https://example.org/catalogue',
      retrievedAt: now,
      snapshotAssetId: null,
      blockId: null,
      excerptAsRetrieved: 'Catalogue description',
    },
    relation: 'background',
    availability: 'link_only',
    verification: 'located',
  };
}
