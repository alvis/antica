import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { createDatabase } from '../connection.js';
import { jobs, records } from '../schema/index.js';

import { createEditDraftRepository } from './edit-drafts.js';

import type {
  EditDraftRunRecord,
  ModelInvocation,
} from '@antica/application/ports';
import type { EditDraftResult, RecordFields } from '@antica/contracts';

import type { Transaction } from '../transaction.js';

const databaseUrl = process.env.ANTICA_TEST_DATABASE_URL ?? '';
if (!databaseUrl) {
  throw new Error(
    'ANTICA_TEST_DATABASE_URL must identify an isolated migrated database',
  );
}
const rollback = new Error('Rollback edit draft test transaction');

async function inRolledBackTransaction(
  operation: (tx: Transaction) => Promise<void>,
): Promise<void> {
  const database = createDatabase({ url: databaseUrl, maxConnections: 1 });
  try {
    await expect(
      database.db.transaction(async (tx) => {
        await operation(tx);
        throw rollback;
      }),
    ).rejects.toBe(rollback);
  } finally {
    await database.close();
  }
}

describe('fn:createEditDraftRepository', () => {
  it('should preserve frozen inputs and apply generated proposals incrementally with revision checks', async () => {
    await inRolledBackTransaction(async (tx) => {
      const ownerId = randomUUID();
      const recordId = randomUUID();
      const editDraftId = randomUUID();
      const jobId = randomUUID();
      const transcriptionId = randomUUID();
      const observationId = randomUUID();
      const descriptionId = randomUUID();
      const nameId = randomUUID();
      const now = '2026-10-13T04:00:00.000Z';
      await tx.insert(records).values({
        id: recordId,
        ownerId,
        code: `TEST-${recordId}`,
        unitKind: 'single',
        name: 'Collector name',
        description: 'Original description',
      });
      await tx.insert(jobs).values({
        id: jobId,
        ownerId,
        kind: 'recordEditing',
        resourceId: editDraftId,
        state: 'queued',
        stage: 'draft',
      });
      const fields: RecordFields = {
        name: 'Collector name',
        unitKind: 'single',
        components: [],
        pieceCount: null,
        categoryIds: [],
        materialIds: [],
        period: null,
        dimensions: {},
        location: { locationId: null, detail: '' },
        acquisition: { receiptAssetIds: [] },
        tags: [],
        description: 'Original description',
        collectorJudgment: null,
      };
      const versions = {
        recordRevision: 1,
        analysisInputVersion: 1,
        evidenceVersion: 1,
      };
      const run: EditDraftRunRecord = {
        detail: {
          editDraftId,
          jobId,
          revision: 1,
          status: 'pending',
          snapshot: {
            recordId,
            versions,
            fields,
            transcriptionVersions: [{ id: transcriptionId, revision: 2 }],
            observationIds: [observationId],
            sourceText: [
              {
                kind: 'transcription',
                id: transcriptionId,
                text: 'Rough surface',
              },
              { kind: 'observation', id: observationId, text: 'Rough surface' },
            ],
            createdAt: now,
          },
          result: null,
          invocation: null,
          appliedProposalIds: [],
          createdAt: now,
          updatedAt: now,
        },
        request: {
          requestKey: editDraftId,
          recordId,
          expectedRecordRevision: 1,
          transcriptionIds: [transcriptionId],
          observationIds: [observationId],
          instructionZhHant: '整理記錄',
        },
        modelSelection: {
          role: 'recordEditing',
          modelId: 'development:evidence-v1',
          profileVersion: '1',
        },
      };
      const result: EditDraftResult = {
        editDraftId,
        recordId,
        baseVersions: versions,
        sourceTranscriptionIds: [transcriptionId],
        sourceObservationIds: [observationId],
        suggestedDescriptionZhHant: '表面粗糙',
        proposedChanges: [
          {
            id: descriptionId,
            field: 'description',
            before: 'Original description',
            proposed: 'Rough surface',
            findingIds: [],
          },
          {
            id: nameId,
            field: 'name',
            before: 'Collector name',
            proposed: 'Catalog name',
            findingIds: [],
          },
        ],
      };
      const invocation: ModelInvocation = {
        requestedModelId: 'development:evidence-v1',
        effectiveModelId: 'development:evidence-v1',
        provider: 'development',
        providerModelVersion: '1',
        adapterKind: 'development',
        capabilities: {
          textInput: true,
          imageInput: false,
          audioInput: false,
          structuredOutput: true,
          toolCalling: false,
        },
        role: 'recordEditing',
        profileVersion: '1',
        promptVersion: '1',
        schemaVersion: '1',
        effectiveOptions: {},
        latencyMs: 0,
        usage: { inputTokens: null, outputTokens: null },
        finishReason: 'stop',
        citationCheck: { valid: true, rejectedReferenceIds: [] },
      };
      const repository = createEditDraftRepository(tx, ownerId);
      const foreign = createEditDraftRepository(tx, randomUUID());

      expect(await repository.get(editDraftId)).toBeNull();
      await expect(
        repository.create({
          ...run,
          detail: { ...run.detail, status: 'ready' },
        }),
      ).rejects.toThrow(Error);
      await expect(foreign.create(run)).rejects.toThrow(Error);
      await repository.create(run);
      expect(await repository.get(editDraftId)).toEqual(run);
      expect(await foreign.get(editDraftId)).toBeNull();
      expect(
        await foreign.saveResult(editDraftId, result, invocation, 1, now),
      ).toBe(false);
      expect(
        await repository.saveResult(editDraftId, result, invocation, 1, now),
      ).toBe(true);
      expect(
        await repository.saveResult(editDraftId, result, invocation, 1, now),
      ).toBe(false);
      expect((await repository.get(editDraftId))?.detail).toMatchObject({
        status: 'ready',
        revision: 2,
        result,
        invocation,
      });
      expect(await repository.markApplied(editDraftId, 2, [], now)).toBeNull();
      expect(
        await repository.markApplied(
          editDraftId,
          2,
          [descriptionId, descriptionId],
          now,
        ),
      ).toBeNull();
      expect(
        await repository.markApplied(editDraftId, 2, [randomUUID()], now),
      ).toBeNull();
      const competingApplies = await Promise.all([
        repository.markApplied(editDraftId, 2, [descriptionId], now),
        repository.markApplied(editDraftId, 2, [descriptionId], now),
      ]);
      expect(
        competingApplies.filter((applied) => applied !== null),
      ).toHaveLength(1);
      expect(competingApplies).toContain(null);
      expect(
        competingApplies.find((applied) => applied !== null),
      ).toMatchObject({
        status: 'partially_applied',
        revision: 3,
        appliedProposalIds: [descriptionId],
      });
      expect(
        await repository.markApplied(editDraftId, 2, [nameId], now),
      ).toBeNull();
      expect(
        await repository.markApplied(editDraftId, 3, [descriptionId], now),
      ).toMatchObject({
        status: 'partially_applied',
        revision: 4,
        appliedProposalIds: [descriptionId],
      });
      expect(
        await repository.markApplied(editDraftId, 4, [nameId], now),
      ).toMatchObject({
        status: 'applied',
        revision: 5,
        appliedProposalIds: [descriptionId, nameId],
      });
      expect(
        await repository.markApplied(editDraftId, 5, [nameId], now),
      ).toBeNull();
      expect((await repository.get(editDraftId))?.detail).toMatchObject({
        status: 'applied',
        result,
        invocation,
        appliedProposalIds: [descriptionId, nameId],
      });
    });
  });
});
