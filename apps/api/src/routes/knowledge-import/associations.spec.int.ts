import { randomUUID } from 'node:crypto';

import { describe, expect } from 'vitest';

import { createImportFixture, it, requestRun } from './fixtures/database.js';
import { createProviderFixture, createSnapshot } from './fixtures/provider.js';

import type { Database } from '@antica/platform/database';

describe(
  'fn:createKnowledgeImportHandler:association ownership',
  { timeout: 60_000 },
  () => {
    it.for([
      'valid',
      'foreign-owner',
      'wrong-version-method',
      'wrong-reference-target',
    ] as const)(
      'should enforce exact owner and pinned association identities for %s links',
      async (variation, { database: { db } }) => {
        const base = createProviderFixture({ snapshots: [createSnapshot()] });
        const ownerId = randomUUID();
        const identities = await seedAssociations(
          db,
          variation === 'foreign-owner' ? randomUUID() : ownerId,
        );
        const fixture = {
          ...createImportFixture(db, {
            ...base,
            map: (snapshot) => {
              const mapped = base.map(snapshot);

              return {
                ...mapped,
                draft: {
                  ...mapped.draft,
                  topics: [
                    { topicId: identities.topicId, applicability: 'general' },
                  ],
                  relatedEntryIds: [identities.entryId],
                  methodIds: [
                    variation === 'wrong-version-method'
                      ? identities.otherMethodId
                      : identities.methodId,
                  ],
                  methodVersionIds: [identities.versionId],
                  referenceLinks: [
                    {
                      id: identities.linkId,
                      targetRecordId:
                        variation === 'wrong-reference-target'
                          ? randomUUID()
                          : identities.recordId,
                    },
                  ],
                },
              };
            },
          }),
          ownerId,
        };
        const run = await requestRun(fixture);
        if (variation !== 'valid') {
          await expect(fixture.handle(run.jobId)).rejects.toThrow(
            'not owner scoped',
          );
          expect(await db.importItem.count({ where: { runId: run.id } })).toBe(
            0,
          );
          expect(await db.externalObject.count({ where: { ownerId } })).toBe(0);

          return;
        }
        await fixture.handle(run.jobId);
        expect(await fixture.store.get(ownerId, run.id)).toMatchObject({
          status: 'completed',
          counts: { imported: 1 },
        });
        const revision = await db.knowledgeRevisions.findFirstOrThrow({
          where: {
            knowledgeEntries: { ownerId, contentId: 'import:fixture:object-1' },
          },
        });
        expect(revision.content).toMatchObject({
          methodIds: [identities.methodId],
          methodVersionIds: [identities.versionId],
          referenceLinks: [
            { id: identities.linkId, targetRecordId: identities.recordId },
          ],
        });
        expect(
          await db.knowledgeRevisionMethods.findMany({
            where: { entryId: revision.entryId },
          }),
        ).toMatchObject([{ methodId: identities.methodId }]);
        expect(
          await db.knowledgeRevisionTopic.findMany({
            where: { entryId: revision.entryId },
          }),
        ).toMatchObject([{ topicId: identities.topicId }]);
      },
    );
  },
);

/**
 * creates real owner-scoped association targets independently of import persistence
 * @param db isolated migrated PostgreSQL database
 * @param ownerId owner of every linked entity
 * @returns linked entry, method versions, topic and reference identities
 */
async function seedAssociations(db: Database, ownerId: string) {
  const entryId = randomUUID();
  const methodId = randomUUID();
  const otherMethodId = randomUUID();
  const versionId = randomUUID();
  const topicId = randomUUID();
  const recordId = randomUUID();
  const linkId = randomUUID();
  await db.knowledgeEntries.create({
    data: {
      id: entryId,
      ownerId,
      displayCode: `LINK-${entryId}`,
      contentId: `linked:${entryId}`,
      currentRevision: 1,
    },
  });
  await db.inspectionMethods.createMany({
    data: [
      { id: methodId, owningEntryId: entryId },
      { id: otherMethodId, owningEntryId: entryId },
    ],
  });
  await db.methodVersions.create({
    data: {
      id: versionId,
      methodId,
      revision: 1,
      definition: {},
      contentHash: 'a'.repeat(64),
    },
  });
  await db.topic.create({
    data: {
      id: topicId,
      ownerId,
      contentId: `topic:${topicId}`,
      facet: 'material',
    },
  });
  await db.records.create({
    data: { id: recordId, ownerId, code: `R-${recordId}`, unitKind: 'single' },
  });
  await db.referenceLinks.create({
    data: {
      id: linkId,
      ownerId,
      targetRecordId: recordId,
      subjectKind: 'record',
      subjectRecordId: recordId,
      targetIdentityKey: recordId,
      subjectIdentityKey: entryId,
    },
  });

  return {
    entryId,
    methodId,
    otherMethodId,
    versionId,
    topicId,
    recordId,
    linkId,
  };
}
