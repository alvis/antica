import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import {
  createAnalysisHandler,
  createAnalysisService,
  createEvidenceService,
  createOutboxDrain,
  createRecordService,
} from '@antica/application/server';
import { createDatabase, createTransactionPort } from '@antica/platform';
import { createDevelopmentModels } from '@antica/platform/ai';

import type {
  AnalysisModelPort,
  TextRetrievalPort,
} from '@antica/application/ports';

const databaseUrl = process.env.ANTICA_TEST_DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    'ANTICA_TEST_DATABASE_URL must identify an isolated migrated acceptance database',
  );
}
const clock = { now: (): string => '2026-10-13T00:00:00.000Z' };
const ids = { create: randomUUID };
const index = {
  embeddingModelId: 'acceptance:no-external-retrieval',
  dimensions: 1,
  indexVersion: '1',
};

function createServices(db: Parameters<typeof createTransactionPort>[0]) {
  const transaction = createTransactionPort(db);
  const models = createDevelopmentModels();
  const records = createRecordService(transaction, clock, ids);
  const evidence = createEvidenceService(transaction, clock, ids);
  const analysis = createAnalysisService(
    transaction,
    {
      resolve: async (selection, required) =>
        models.catalog.resolve(
          { ...selection, modelId: 'development:evidence-v1' },
          required,
        ),
    },
    {
      role: 'analysis',
      modelId: 'development:evidence-v1',
      profileVersion: '1',
    },
    clock,
    ids,
  );
  const text: TextRetrievalPort = {
    search: async () => ({
      success: true,
      data: { items: [], nextCursor: null },
    }),
    snapshot: async () => ({
      success: true,
      data: {
        id: randomUUID(),
        index,
        citations: [],
        text: [],
        methods: [],
        createdAt: clock.now(),
      },
    }),
  };
  const handler = (model: AnalysisModelPort = models.analysis) =>
    createAnalysisHandler({
      transaction,
      text,
      index,
      model,
      catalog: models.catalog,
      media: {
        read: async () => {
          throw new Error('No image evidence in this fixture');
        },
        renderRegion: async () => {
          throw new Error('No image region in this fixture');
        },
      },
      clock,
    });

  return { transaction, records, evidence, analysis, handler };
}

async function seed(
  services: ReturnType<typeof createServices>,
  ownerId: string,
) {
  const record = await services.records.create(ownerId, randomUUID(), {
    unitKind: 'single',
    description: 'Frozen collector description',
  });
  if (!record.success) {
    throw new Error('Record fixture failed');
  }
  const observed = await services.evidence.addObservation(
    ownerId,
    randomUUID(),
    {
      recordId: record.data.id,
      componentIds: [],
      channel: 'typed',
      text: '表面手感粗糙',
      evidenceAnchorIds: [],
      checkIds: [],
      observedAt: clock.now(),
      voice: null,
      editDraftId: null,
      supersedesObservationId: null,
    },
  );
  if (!observed.success) {
    throw new Error('Observation fixture failed');
  }
  const accepted = await services.analysis.request(
    ownerId,
    record.data.id,
    randomUUID(),
    { expectedRecordRevision: 2 },
  );
  if (!accepted.success) {
    throw new Error('Analysis fixture failed');
  }

  return {
    recordId: record.data.id,
    observationId: observed.data.id,
    ...accepted.data,
  };
}

describe('Persistent analysis lifecycle', () => {
  it.each(['supplied', 'dismissed'] as const)(
    'should reopen %s action state, exclude it from pending tasks, and preserve CAS rollback and replay',
    async (status) => {
      const database = createDatabase({ url: databaseUrl });
      const ownerId = randomUUID();
      const services = createServices(database.db);
      try {
        const fixture = await seed(services, ownerId);
        expect(await services.handler()(ownerId, fixture.jobId)).toMatchObject({
          success: true,
        });
        const completed = await services.analysis.get(ownerId, fixture.runId);
        if (
          !completed.success ||
          !completed.data.result.output?.nextActions[0]
        ) {
          throw new Error('Analysis action missing');
        }
        const action = completed.data.result.output.nextActions[0];
        const key = randomUUID();
        const input =
          status === 'supplied'
            ? {
                expectedRecordRevision: 2,
                expectedActionRevision: 1,
                status,
                support: { observationIds: [fixture.observationId] },
              }
            : {
                expectedRecordRevision: 2,
                expectedActionRevision: 1,
                status,
                reason: 'Collector declines this action',
              };
        const resolved = await services.analysis.resolveAction(
          ownerId,
          fixture.runId,
          action.id,
          key,
          input,
        );
        expect(resolved).toMatchObject({
          success: true,
          data: {
            state: { status, revision: 2 },
            versions: { recordRevision: 3 },
          },
        });
        const reopened = await createServices(database.db).analysis.get(
          ownerId,
          fixture.runId,
        );
        expect(reopened).toMatchObject({
          success: true,
          data: {
            result: {
              actionStates: expect.arrayContaining([
                expect.objectContaining({
                  actionId: action.id,
                  status,
                  revision: 2,
                }),
              ]),
            },
          },
        });
        const tasks = await services.analysis.tasks(ownerId, {
          recordId: fixture.recordId,
        });
        if (!tasks.success) {
          throw new Error('Tasks query failed');
        }
        expect(
          tasks.data.items.filter(
            (task) =>
              task.kind === 'analysisAction' &&
              task.state.actionId === action.id,
          ),
        ).toEqual([]);
        expect(
          await services.analysis.resolveAction(
            ownerId,
            fixture.runId,
            action.id,
            randomUUID(),
            { ...input, expectedRecordRevision: 3 },
          ),
        ).toMatchObject({
          success: false,
          error: { code: 'REVISION_CONFLICT' },
        });
        expect(await services.analysis.get(ownerId, fixture.runId)).toEqual(
          reopened,
        );
        expect(
          await services.records.get(ownerId, fixture.recordId),
        ).toMatchObject({ success: true, data: { recordRevision: 3 } });
        expect(
          await services.analysis.resolveAction(
            ownerId,
            fixture.runId,
            action.id,
            key,
            input,
          ),
        ).toEqual(resolved);
      } finally {
        await database.close();
      }
    },
  );

  it('should create a different model run over the same immutable saved snapshot after the record changes', async () => {
    const database = createDatabase({ url: databaseUrl });
    const ownerId = randomUUID();
    const services = createServices(database.db);
    try {
      const fixture = await seed(services, ownerId);
      expect(await services.handler()(ownerId, fixture.jobId)).toMatchObject({
        success: true,
      });
      expect(
        await services.records.patch(ownerId, fixture.recordId, randomUUID(), {
          expectedRevision: 2,
          fields: { description: 'Later collector correction' },
        }),
      ).toMatchObject({ success: true });
      const replayKey = randomUUID();
      const input = {
        expectedRecordRevision: 3,
        inputSnapshotId: fixture.inputSnapshotId,
        modelId: 'acceptance:comparison-model',
      };
      const second = await services.analysis.request(
        ownerId,
        fixture.recordId,
        replayKey,
        input,
      );
      expect(second).toMatchObject({
        success: true,
        data: { inputSnapshotId: fixture.inputSnapshotId },
      });
      if (!second.success) {
        throw new Error('Comparison run failed');
      }
      expect(second.data.runId).not.toBe(fixture.runId);
      expect(
        await services.analysis.request(
          ownerId,
          fixture.recordId,
          replayKey,
          input,
        ),
      ).toEqual(second);
      const persisted = await services.transaction.run(
        ownerId,
        async (unit) => ({
          success: true,
          data: [
            await unit.analyses.get(fixture.runId),
            await unit.analyses.get(second.data.runId),
          ],
        }),
      );
      expect(persisted.data[1]?.requestedSnapshot).toEqual(
        persisted.data[0]?.requestedSnapshot,
      );
      expect(persisted.data[1]).toMatchObject({
        modelSelection: { modelId: input.modelId },
        requestedSnapshot: {
          recordRevision: 2,
          frozenPack: {
            recordFields: { description: 'Frozen collector description' },
          },
        },
      });
    } finally {
      await database.close();
    }
  });

  it('should persist a terminal model failure for run and job polling without invoking the provider on replay', async () => {
    const database = createDatabase({ url: databaseUrl });
    const ownerId = randomUUID();
    const services = createServices(database.db);
    const analyze = vi.fn<AnalysisModelPort['analyze']>(async () => ({
      success: false,
      error: {
        code: 'MODEL_OUTPUT_INVALID',
        message: 'Provider output violates the schema',
        retryable: false,
      },
      audit: { invocation: null, rawOutput: null },
    }));
    const handler = services.handler({ analyze });
    try {
      const fixture = await seed(services, ownerId);
      const drain = createOutboxDrain({
        transaction: services.transaction,
        clock,
        handlers: { analysis: handler },
        listPending: async (limit) =>
          (
            await services.transaction.run(ownerId, async (unit) => ({
              success: true,
              data: await unit.outbox.pending(limit),
            }))
          ).data,
      });
      await drain();
      expect(
        await createServices(database.db).analysis.get(ownerId, fixture.runId),
      ).toMatchObject({
        success: true,
        data: { status: 'failed', result: { output: null } },
      });
      expect(
        await services.transaction.run(ownerId, async (unit) => ({
          success: true,
          data: await unit.jobs.get(fixture.jobId),
        })),
      ).toMatchObject({ success: true, data: { state: { kind: 'failed' } } });
      await handler(ownerId, fixture.jobId);
      await drain();
      expect(analyze).toHaveBeenCalledTimes(1);
    } finally {
      await database.close();
    }
  });
});
