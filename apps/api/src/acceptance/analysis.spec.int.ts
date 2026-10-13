import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  createAnalysisHandler,
  createAnalysisService,
  createEvidenceService,
  createRecordService,
} from '@antica/application/server';

import { createDatabase, createTransactionPort } from '@antica/platform';
import { createDevelopmentModels } from '@antica/platform/ai';

import type { TextRetrievalPort } from '@antica/application/ports';

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

describe('Persistent explicit analysis', () => {
  it.each([false, true])(
    'should freeze the requested evidence, persist one replayable run, and require collector adoption (later edit: %s)',
    async (editAfterRequest) => {
      const database = createDatabase({ url: databaseUrl });
      const ownerId = randomUUID();
      const transaction = createTransactionPort(database.db);
      const records = createRecordService(transaction, clock, ids);
      const evidence = createEvidenceService(transaction, clock, ids);
      const models = createDevelopmentModels();
      const analysis = createAnalysisService(
        transaction,
        models.catalog,
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
      const handler = createAnalysisHandler({
        transaction,
        text,
        index,
        model: models.analysis,
        catalog: models.catalog,
        media: {
          renderRegion: async () => {
            throw new Error('No image region was submitted');
          },
          read: async () => {
            throw new Error('No image evidence was submitted');
          },
        },
        clock,
      });
      try {
        const created = await records.create(ownerId, randomUUID(), {
          unitKind: 'single',
          description: 'Original collector description',
        });
        if (!created.success) {
          throw new Error('Record fixture failed');
        }
        const observed = await evidence.addObservation(ownerId, randomUUID(), {
          recordId: created.data.id,
          componentIds: [],
          channel: 'typed',
          text: '摸落去有啲粗糙。',
          evidenceAnchorIds: [],
          checkIds: [],
          observedAt: clock.now(),
          voice: null,
          editDraftId: null,
          supersedesObservationId: null,
        });
        if (!observed.success) {
          throw new Error('Observation fixture failed');
        }
        const requestKey = randomUUID();
        const request = { expectedRecordRevision: 2 };
        const accepted = await analysis.request(
          ownerId,
          created.data.id,
          requestKey,
          request,
        );
        if (!accepted.success) {
          throw new Error('Analysis request failed');
        }
        expect(
          await analysis.request(ownerId, created.data.id, requestKey, request),
        ).toEqual(accepted);
        expect(
          await analysis.get(randomUUID(), accepted.data.runId),
        ).toMatchObject({ success: false, error: { code: 'NOT_FOUND' } });
        if (editAfterRequest) {
          expect(
            await records.patch(ownerId, created.data.id, randomUUID(), {
              expectedRevision: 2,
              fields: { description: 'New collector correction' },
            }),
          ).toMatchObject({ success: true });
        }

        expect(await handler(ownerId, accepted.data.jobId)).toEqual({
          success: true,
          data: undefined,
        });
        const completed = await analysis.get(ownerId, accepted.data.runId);
        expect(await handler(ownerId, accepted.data.jobId)).toEqual({
          success: true,
          data: undefined,
        });
        expect(await analysis.get(ownerId, accepted.data.runId)).toEqual(
          completed,
        );
        if (!completed.success || !completed.data.result.output) {
          throw new Error('Analysis did not complete');
        }
        expect(completed.data).toMatchObject({
          status: 'completed',
          snapshot: {
            recordRevision: 2,
            analysisInputVersion: 2,
            observationIds: [observed.data.id],
          },
        });
        const proposal = completed.data.result.output.proposedChanges[0]!;
        expect(proposal).toMatchObject({
          field: 'description',
          before: 'Original collector description',
          proposed: 'Original collector description\n摸落去有啲粗糙。',
        });
        expect(await records.get(ownerId, created.data.id)).toMatchObject({
          success: true,
          data: {
            description: editAfterRequest
              ? 'New collector correction'
              : 'Original collector description',
          },
        });

        const adoptionKey = randomUUID();
        const adoption = {
          expectedRecordRevision: editAfterRequest ? 3 : 2,
          selectedProposalIds: [proposal.id],
        };
        const applied = await analysis.apply(
          ownerId,
          accepted.data.runId,
          adoptionKey,
          adoption,
        );
        if (editAfterRequest) {
          expect(applied).toMatchObject({
            success: false,
            error: { code: 'REVISION_CONFLICT' },
          });
          expect(await records.get(ownerId, created.data.id)).toMatchObject({
            success: true,
            data: {
              description: 'New collector correction',
              recordRevision: 3,
            },
          });
        } else {
          expect(applied).toMatchObject({
            success: true,
            data: {
              description: proposal.proposed,
              recordRevision: 3,
              analysisInputVersion: 2,
            },
          });
          expect(
            await analysis.apply(
              ownerId,
              accepted.data.runId,
              adoptionKey,
              adoption,
            ),
          ).toEqual(applied);
          const action = completed.data.result.output.nextActions[0]!;
          const resolutionKey = randomUUID();
          const resolution = {
            expectedRecordRevision: 3,
            expectedActionRevision: 1,
            status: 'supplied' as const,
            support: { observationIds: [observed.data.id] },
          };
          const resolved = await analysis.resolveAction(
            ownerId,
            accepted.data.runId,
            action.id,
            resolutionKey,
            resolution,
          );
          expect(resolved).toMatchObject({
            success: true,
            data: {
              state: { status: 'supplied', revision: 2 },
              versions: {
                recordRevision: 4,
                analysisInputVersion: 2,
                evidenceVersion: 1,
              },
            },
          });
          expect(
            await analysis.resolveAction(
              ownerId,
              accepted.data.runId,
              action.id,
              resolutionKey,
              resolution,
            ),
          ).toEqual(resolved);
          expect(await records.get(ownerId, created.data.id)).toMatchObject({
            success: true,
            data: { checkIds: [], recordRevision: 4 },
          });
        }
        const pending = await transaction.run(ownerId, async (unit) => ({
          success: true,
          data: await unit.outbox.pending(100),
        }));
        expect(pending).toMatchObject({
          success: true,
          data: [
            {
              name: 'antica.analysis.requested',
              event: { resourceId: accepted.data.runId },
            },
          ],
        });
      } finally {
        await database.close();
      }
    },
  );
});
