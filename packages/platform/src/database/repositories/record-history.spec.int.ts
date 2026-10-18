import { randomUUID } from 'node:crypto';

import { describe, expect, inject } from 'vitest';

import { InvalidCursorError } from '@antica/application/ports';

import { createDatabaseTest } from '../spec/fixtures/runner.js';
import { createTransactionPort } from '../transaction.js';

import type { TransactionPort, UnitOfWork } from '@antica/application/ports';
import type {
  AnalysisOutput,
  CursorPage,
  ModelInvocation,
  RecordDetail,
  RecordFields,
  RecordHistoryEntry,
} from '@antica/contracts';

const resources = inject('platformDatabases');
const it = createDatabaseTest(resources['record-history']!);
const now = '2026-10-17T00:00:00.000Z';
const fields: RecordFields = {
  name: 'Vase',
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
  description: 'Collector description',
  collectorJudgment: null,
};
const versions = {
  recordRevision: 1,
  analysisInputVersion: 1,
  evidenceVersion: 1,
};
const invocation: ModelInvocation = {
  requestedModelId: 'development',
  effectiveModelId: 'development',
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
  role: 'analysis',
  profileVersion: '1',
  promptVersion: '1',
  schemaVersion: '1',
  effectiveOptions: {},
  latencyMs: 0,
  usage: { inputTokens: null, outputTokens: null },
  finishReason: 'stop',
  citationCheck: { valid: true, rejectedReferenceIds: [] },
};

/**
 * runs one committed owner-scoped unit of work
 * @param transaction transaction port under test
 * @param ownerId collector scope
 * @param work repository calls
 * @returns the work result
 */
async function inUnit<T>(
  transaction: TransactionPort,
  ownerId: string,
  work: (unit: UnitOfWork) => Promise<T>,
): Promise<T> {
  const result = await transaction.run(ownerId, async (unit) => ({
    success: true as const,
    data: await work(unit),
  }));

  return result.data;
}

/**
 * creates a record owned by the collector
 * @param unit owner-scoped repositories
 * @returns new record identifier
 */
async function createRecord(unit: UnitOfWork): Promise<string> {
  const record: RecordDetail = {
    ...fields,
    ...versions,
    id: randomUUID(),
    code: await unit.records.allocateCode(),
    createdAt: now,
    updatedAt: now,
    mediaIds: [],
    checkIds: [],
    latestRunId: null,
    analysisFreshness: 'unanalyzed',
  };
  await unit.records.create(record);

  return record.id;
}

/**
 * creates a completed analysis run with the given proposals
 * @param unit owner-scoped repositories
 * @param recordId analysed record
 * @param proposedChanges generated proposals
 * @returns run identifier
 */
async function createCompletedRun(
  unit: UnitOfWork,
  recordId: string,
  proposedChanges: AnalysisOutput['proposedChanges'],
): Promise<string> {
  const runId = randomUUID();
  const jobId = randomUUID();
  await unit.jobs.create({
    id: jobId,
    kind: 'analysis',
    resourceId: runId,
    state: { kind: 'queued' },
    createdAt: now,
    updatedAt: now,
    result: null,
  });
  await unit.analyses.create({
    id: runId,
    jobId,
    recordId,
    requestedSnapshot: {
      id: randomUUID(),
      recordId,
      ...versions,
      assetIds: [],
      evidenceIds: [],
      observationIds: [],
      checkIds: [],
      frozenPack: {
        recordFields: fields,
        media: [],
        evidence: [],
        observations: [],
        checks: [],
      },
      createdAt: now,
    },
    modelSelection: {
      role: 'analysis',
      modelId: 'development',
      profileVersion: '1',
    },
    input: null,
    retrievalSnapshot: null,
    output: null,
    invocation: null,
    failureAudits: [],
    suggestedMethodVersions: [],
    status: 'queued',
  });
  await unit.analyses.saveOutput(
    runId,
    {
      summary: 'Summary',
      findings: [],
      uncertainties: [],
      suggestedMethodIds: [],
      nextActions: [],
      proposedChanges,
    },
    [],
    invocation,
    'completed',
  );

  return runId;
}

/**
 * creates a ready edit draft with the given proposals
 * @param unit owner-scoped repositories
 * @param recordId edited record
 * @param proposedChanges generated proposals
 * @returns draft identifier
 */
async function createReadyDraft(
  unit: UnitOfWork,
  recordId: string,
  proposedChanges: AnalysisOutput['proposedChanges'],
): Promise<string> {
  const editDraftId = randomUUID();
  const jobId = randomUUID();
  const observationId = randomUUID();
  await unit.jobs.create({
    id: jobId,
    kind: 'recordEditing',
    resourceId: editDraftId,
    state: { kind: 'queued' },
    createdAt: now,
    updatedAt: now,
    result: null,
  });
  await unit.editDrafts.create({
    detail: {
      editDraftId,
      jobId,
      revision: 1,
      status: 'pending',
      snapshot: {
        recordId,
        versions,
        fields,
        transcriptionVersions: [],
        observationIds: [observationId],
        sourceText: [{ kind: 'observation', id: observationId, text: 'Text' }],
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
      transcriptionIds: [],
      observationIds: [observationId],
      instructionZhHant: '整理',
    },
    modelSelection: {
      role: 'recordEditing',
      modelId: 'development',
      profileVersion: '1',
    },
  });
  await unit.editDrafts.saveResult(
    editDraftId,
    {
      editDraftId,
      recordId,
      baseVersions: versions,
      sourceTranscriptionIds: [],
      sourceObservationIds: [observationId],
      replyZhHant: '',
      suggestedDescriptionZhHant: 'Text',
      proposedChanges,
    },
    { ...invocation, role: 'recordEditing' },
    1,
    now,
  );

  return editDraftId;
}

/**
 * reads every page of a record history
 * @param transaction transaction port under test
 * @param ownerId collector scope
 * @param recordId record whose history is read
 * @returns entries across pages and the number of pages
 */
async function readAllPages(
  transaction: TransactionPort,
  ownerId: string,
  recordId: string,
): Promise<{ entries: RecordHistoryEntry[]; pages: number }> {
  const entries: RecordHistoryEntry[] = [];
  let cursor: string | undefined;
  let pages = 0;
  do {
    const page: CursorPage<RecordHistoryEntry> = await inUnit(
      transaction,
      ownerId,
      async (unit) => unit.records.queryHistory(recordId, { cursor, limit: 1 }),
    );
    entries.push(...page.items);
    cursor = page.nextCursor ?? undefined;
    pages += 1;
  } while (cursor);

  return { entries, pages };
}

describe('fn:queryRecordHistory', { timeout: 30_000 }, () => {
  it('should merge both suggestion flows newest first and page through them without gaps', async ({
    connection,
  }) => {
    const transaction = createTransactionPort(connection.db);
    const ownerId = randomUUID();
    const descriptionId = randomUUID();
    const seeded = await inUnit(transaction, ownerId, async (unit) => {
      const recordId = await createRecord(unit);
      const otherRecordId = await createRecord(unit);
      const runId = await createCompletedRun(unit, recordId, [
        {
          id: randomUUID(),
          field: 'name',
          before: 'Vase',
          proposed: 'Blue vase',
          findingIds: [],
        },
        {
          id: randomUUID(),
          field: 'tags',
          before: [],
          proposed: ['blue'],
          findingIds: [],
        },
      ]);
      const editDraftId = await createReadyDraft(unit, recordId, [
        {
          id: descriptionId,
          field: 'description',
          before: 'Collector description',
          proposed: 'Edited description',
          findingIds: [],
        },
      ]);
      await createReadyDraft(unit, otherRecordId, [
        {
          id: randomUUID(),
          field: 'collectorJudgment',
          before: null,
          proposed: 'Other record',
          findingIds: [],
        },
      ]);

      // the analysis repository scopes generated proposal identities to the run
      const proposed = (await unit.analyses.get(runId))!.output!
        .proposedChanges;

      return {
        recordId,
        otherRecordId,
        runId,
        editDraftId,
        nameId: proposed.find((change) => change.field === 'name')!.id,
        tagsId: proposed.find((change) => change.field === 'tags')!.id,
      };
    });
    const oldest = await inUnit(transaction, ownerId, async (unit) => {
      const accepted = randomUUID();
      const skipped = randomUUID();
      await unit.analyses.appendAdoption(
        seeded.runId,
        seeded.nameId,
        'accepted',
        accepted,
      );
      await unit.analyses.appendAdoption(
        seeded.runId,
        seeded.tagsId,
        'skipped',
        skipped,
      );

      return [accepted, skipped].sort().reverse();
    });
    const newest = await inUnit(transaction, ownerId, async (unit) => {
      const eventId = randomUUID();
      await unit.editDrafts.markApplied(
        seeded.editDraftId,
        2,
        [descriptionId],
        now,
      );
      await unit.editDrafts.appendAdoption(
        seeded.editDraftId,
        descriptionId,
        'accepted',
        eventId,
      );

      return eventId;
    });

    const full = await inUnit(transaction, ownerId, async (unit) =>
      unit.records.queryHistory(seeded.recordId, {}),
    );
    expect(full.nextCursor).toBeNull();
    expect(full.items.map((entry) => entry.id)).toEqual([newest, ...oldest]);
    expect(full.items).toContainEqual({
      id: newest,
      occurredAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T.*Z$/),
      field: 'description',
      before: 'Collector description',
      after: 'Edited description',
      status: 'accepted',
      source: {
        kind: 'editDraft',
        editDraftId: seeded.editDraftId,
        proposalId: descriptionId,
        recordMessageId: null,
      },
    });
    expect(full.items).toContainEqual(
      expect.objectContaining({
        field: 'name',
        before: 'Vase',
        after: 'Blue vase',
        status: 'accepted',
        source: {
          kind: 'analysis',
          runId: seeded.runId,
          proposalId: seeded.nameId,
        },
      }),
    );
    expect(full.items).toContainEqual(
      expect.objectContaining({
        field: 'tags',
        status: 'skipped',
        source: {
          kind: 'analysis',
          runId: seeded.runId,
          proposalId: seeded.tagsId,
        },
      }),
    );
    const paged = await readAllPages(transaction, ownerId, seeded.recordId);
    expect(paged.entries).toEqual(full.items);
    expect(paged.pages).toBe(3);
    expect(
      await inUnit(transaction, ownerId, async (unit) =>
        unit.records.queryHistory(seeded.otherRecordId, {}),
      ),
    ).toEqual({ items: [], nextCursor: null });
    expect(
      await inUnit(transaction, randomUUID(), async (unit) =>
        unit.records.queryHistory(seeded.recordId, {}),
      ),
    ).toEqual({ items: [], nextCursor: null });
  });

  it.for([
    ['malformed', 'not-json'],
    [
      'foreign',
      Buffer.from(JSON.stringify({ occurredAt: now })).toString('base64url'),
    ],
    [
      'tampered',
      Buffer.from(
        JSON.stringify({ occurredAt: 'yesterday', id: randomUUID() }),
      ).toString('base64url'),
    ],
  ] as const)(
    'should reject a %s cursor as invalid input',
    async ([, cursor], { connection }) => {
      const transaction = createTransactionPort(connection.db);

      await expect(
        inUnit(transaction, randomUUID(), async (unit) =>
          unit.records.queryHistory(randomUUID(), { cursor }),
        ),
      ).rejects.toThrow(InvalidCursorError);
    },
  );
});

describe(
  'fn:createEditDraftRepository.appendAdoption',
  { timeout: 30_000 },
  () => {
    it('should record only applied proposals of the owner once at the current record revision', async ({
      connection,
    }) => {
      const transaction = createTransactionPort(connection.db);
      const ownerId = randomUUID();
      const appliedId = randomUUID();
      const pendingId = randomUUID();
      const seeded = await inUnit(transaction, ownerId, async (unit) => {
        const recordId = await createRecord(unit);
        const editDraftId = await createReadyDraft(unit, recordId, [
          {
            id: appliedId,
            field: 'name',
            before: 'Vase',
            proposed: 'Blue vase',
            findingIds: [],
          },
          {
            id: pendingId,
            field: 'period',
            before: null,
            proposed: { label: 'Song', status: 'unconfirmed' },
            findingIds: [],
          },
        ]);
        await unit.records.patch(
          recordId,
          { expectedRevision: 1, fields: { name: 'Blue vase' } },
          { ...versions, recordRevision: 2 },
        );
        await unit.editDrafts.markApplied(editDraftId, 2, [appliedId], now);

        return { recordId, editDraftId };
      });
      const attempt = async (
        owner: string,
        proposalId: string,
        status: 'accepted' | 'skipped',
      ): Promise<void> =>
        inUnit(transaction, owner, async (unit) =>
          unit.editDrafts.appendAdoption(
            seeded.editDraftId,
            proposalId,
            status,
            randomUUID(),
          ),
        );

      await expect(attempt(ownerId, pendingId, 'accepted')).rejects.toThrow(
        'Edit draft proposal is not available for history',
      );
      await expect(attempt(ownerId, appliedId, 'skipped')).rejects.toThrow(
        'Edit draft proposal is not available for history',
      );
      await expect(attempt(ownerId, randomUUID(), 'accepted')).rejects.toThrow(
        'Edit draft proposal is not available for history',
      );
      await expect(
        attempt(randomUUID(), appliedId, 'accepted'),
      ).rejects.toThrow('Edit draft proposal is not available for history');
      await attempt(ownerId, pendingId, 'skipped');
      await attempt(ownerId, appliedId, 'accepted');
      await expect(attempt(ownerId, appliedId, 'accepted')).rejects.toThrow();

      const rows = await connection.db.editDraftAdoptionEvents.findMany({
        where: { editDraftId: seeded.editDraftId },
      });
      expect(
        rows.map(
          ({ proposalId, field, before, after, status, recordRevision }) => ({
            proposalId,
            field,
            before,
            after,
            status,
            recordRevision,
          }),
        ),
      ).toEqual(
        expect.arrayContaining([
          {
            proposalId: appliedId,
            field: 'name',
            before: 'Vase',
            after: 'Blue vase',
            status: 'accepted',
            recordRevision: 2,
          },
          {
            proposalId: pendingId,
            field: 'period',
            before: null,
            after: { label: 'Song', status: 'unconfirmed' },
            status: 'skipped',
            recordRevision: 2,
          },
        ]),
      );
      expect(rows).toHaveLength(2);
    });

    it('should refuse history for a draft whose record is no longer visible to the owner', async ({
      connection,
    }) => {
      const transaction = createTransactionPort(connection.db);
      const ownerId = randomUUID();
      const proposalId = randomUUID();
      const seeded = await inUnit(transaction, ownerId, async (unit) => {
        const recordId = await createRecord(unit);
        const editDraftId = await createReadyDraft(unit, recordId, [
          {
            id: proposalId,
            field: 'name',
            before: 'Vase',
            proposed: 'Blue vase',
            findingIds: [],
          },
        ]);
        await unit.editDrafts.markApplied(editDraftId, 2, [proposalId], now);

        return { recordId, editDraftId };
      });
      await connection.db.records.updateMany({
        data: { ownerId: randomUUID() },
        where: { id: seeded.recordId },
      });

      await expect(
        inUnit(transaction, ownerId, async (unit) =>
          unit.editDrafts.appendAdoption(
            seeded.editDraftId,
            proposalId,
            'accepted',
            randomUUID(),
          ),
        ),
      ).rejects.toThrow('Record not found');
    });
  },
);
