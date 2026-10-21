import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { createLinkedAnalysisEvidence } from '../spec/fixtures/analysis-evidence.js';
import { createIsolatedDatabase } from '../spec/fixtures/isolated-database.js';
import { createTransactionPort } from '../transaction.js';

import type { ModelInvocation, RecordDetail } from '@antica/contracts';
import type { EvidenceAnchor, Observation, RecordCheck } from '@antica/domain';

const databaseUrl = process.env.ANTICA_TEST_DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    'ANTICA_TEST_DATABASE_URL must identify an isolated migrated PostgreSQL database',
  );
}

const now = '2026-10-13T00:00:00.000Z';

describe('fn:createEvidenceRepository', { timeout: 30_000 }, () => {
  it('should round-trip video frame evidence in its original time base', async () => {
    const database = await createIsolatedDatabase();
    const transaction = createTransactionPort(database.db);
    const recordId = randomUUID();
    const assetId = randomUUID();
    const frameId = randomUUID();
    const viewId = randomUUID();
    const anchor: EvidenceAnchor = {
      id: randomUUID(),
      recordId,
      componentIds: [],
      originalAssetId: assetId,
      canonicalViewId: viewId,
      kind: 'video_frame',
      scope: { kind: 'whole' },
      frame: {
        streamIndex: 0,
        timeBase: { numerator: 1, denominator: 90000 },
        pts: '180000',
        frameDerivativeId: frameId,
        displayTimeMs: 2000,
      },
      createdAt: now,
    };
    try {
      await transaction.run(database.ownerId, async (unit) => {
        await unit.records.create({
          id: recordId,
          code: await unit.records.allocateCode(),
          name: null,
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
          description: '',
          collectorJudgment: null,
          condition: null,
          recordRevision: 1,
          analysisInputVersion: 1,
          evidenceVersion: 1,
          createdAt: now,
          updatedAt: now,
          mediaIds: [],
          checkIds: [],
          latestRunId: null,
          analysisFreshness: 'unanalyzed',
        });
        await unit.media.createUpload(
          {
            requestKey: randomUUID(),
            target: { kind: 'record', recordId },
            kind: 'video',
            purpose: 'object',
            componentIds: [],
            fileName: 'inspection.mp4',
            mimeType: 'video/mp4',
            byteLength: 5,
            sha256: 'c'.repeat(64),
          },
          {
            assetId,
            mode: 'single',
            expiresAt: '2030-01-01T00:00:00.000Z',
            putUrl: 'https://example.test/upload',
            headers: {},
          },
        );
        await unit.media.addDerivative({
          id: frameId,
          originalAssetId: assetId,
          parentDerivativeId: null,
          kind: 'frame',
          storageKey: `frames/${frameId}`,
          mimeType: 'image/png',
          byteLength: 5,
          sha256: 'd'.repeat(64),
          region: null,
          transformToOriginal: [1, 0, 0, 0, 1, 0, 0, 0, 1],
        });
        await unit.media.addCanonicalView({
          id: viewId,
          originalAssetId: assetId,
          derivativeId: frameId,
          width: 100,
          height: 100,
          originalCoordinateSpace: 'video_frame_pixels',
          transformToOriginal: [1, 0, 0, 0, 1, 0, 0, 0, 1],
        });
        await unit.evidence.addAnchor(anchor);

        return { success: true as const, data: undefined };
      });
      const read = await transaction.run(database.ownerId, async (unit) => ({
        success: true as const,
        data: await unit.evidence.getAnchor(anchor.id),
      }));
      expect(read.data).toEqual(anchor);
    } finally {
      await database.close();
    }
  });

  it('should preserve scoped evidence and check support through compare-and-swap updates', async () => {
    const database = await createIsolatedDatabase();
    const transaction = createTransactionPort(database.db);
    try {
      const fixture = await transaction.run(database.ownerId, async (unit) => ({
        success: true as const,
        data: await createLinkedAnalysisEvidence(unit),
      }));
      const {
        recordId,
        componentId,
        assetId,
        methodVersionId,
        anchor,
        observation,
        check,
      } = fixture.data;
      const read = await transaction.run(database.ownerId, async (unit) => ({
        success: true as const,
        data: {
          anchor: await unit.evidence.getAnchor(anchor.id),
          anchors: await unit.evidence.queryAnchorsByAsset(assetId),
          observation: await unit.evidence.getObservation(observation.id),
          check: await unit.evidence.findActiveCheck(
            recordId,
            methodVersionId,
            [componentId, componentId],
          ),
        },
      }));
      expect(read.data).toEqual({
        anchor,
        anchors: [anchor],
        observation: { ...observation, checkIds: [check.id] },
        check,
      });
      const audioAssetId = randomUUID();
      const transcriptionId = randomUUID();
      const jobId = randomUUID();
      const voice: Observation = {
        ...observation,
        id: randomUUID(),
        channel: 'voice',
        checkIds: [check.id],
        voice: { audioAssetId, transcriptionId, segmentId: null },
      };
      await transaction.run(database.ownerId, async (unit) => {
        await unit.media.createUpload(
          {
            requestKey: randomUUID(),
            target: { kind: 'record', recordId },
            kind: 'audio',
            purpose: 'voice_note',
            componentIds: [],
            fileName: 'inspection.wav',
            mimeType: 'audio/wav',
            byteLength: 5,
            sha256: 'b'.repeat(64),
          },
          {
            assetId: audioAssetId,
            mode: 'single',
            expiresAt: '2030-01-01T00:00:00.000Z',
            putUrl: 'https://example.test/upload',
            headers: {},
          },
        );
        await unit.media.complete(audioAssetId, {
          assetId: audioAssetId,
          state: 'uploaded',
          processingJobId: null,
        });
        await unit.media.markReadyOnce(audioAssetId, 'uploaded');
        await unit.jobs.create({
          id: jobId,
          kind: 'transcription',
          resourceId: transcriptionId,
          state: { kind: 'queued' },
          createdAt: now,
          updatedAt: now,
          result: null,
        });
        await unit.transcriptions.create({
          detail: {
            transcriptionId,
            jobId,
            revision: 1,
            status: 'pending',
            snapshot: {
              recordId,
              recordRevision: 1,
              audioAssetId,
              audioSha256: 'b'.repeat(64),
              createdAt: now,
            },
            result: null,
            invocation: null,
            confirmedObservationId: null,
            createdAt: now,
            updatedAt: now,
          },
          request: {
            requestKey: randomUUID(),
            recordId,
            audioAssetId,
            expectedRecordRevision: 1,
            vocabularyHints: [],
          },
          modelSelection: {
            role: 'transcription',
            modelId: 'development:transcription',
            profileVersion: '1',
          },
        });
        const invocation: ModelInvocation = {
          requestedModelId: 'development:transcription',
          effectiveModelId: 'development:transcription',
          provider: 'development',
          providerModelVersion: '1',
          adapterKind: 'development',
          capabilities: {
            textInput: true,
            imageInput: false,
            audioInput: true,
            structuredOutput: true,
            toolCalling: false,
          },
          role: 'transcription',
          profileVersion: '1',
          promptVersion: '1',
          schemaVersion: '1',
          effectiveOptions: {},
          latencyMs: 0,
          usage: { inputTokens: null, outputTokens: null },
          finishReason: 'stop',
          citationCheck: { valid: true, rejectedReferenceIds: [] },
        };
        await unit.transcriptions.saveResult(
          transcriptionId,
          {
            transcriptionId,
            recordId,
            audioAssetId,
            originalText: voice.text,
            readingTextZhHant: '可見修復',
            detectedLanguages: ['en'],
            uncertainTerms: [],
            segments: [],
          },
          invocation,
          1,
          now,
        );
        await unit.evidence.addObservation(voice);
        await unit.transcriptions.confirm(transcriptionId, 2, voice.id, now);

        return { success: true as const, data: undefined };
      });
      const voiceRead = await transaction.run(
        database.ownerId,
        async (unit) => ({
          success: true as const,
          data: await unit.evidence.getObservation(voice.id),
        }),
      );
      expect(voiceRead.data).toEqual(voice);
      const updated: RecordCheck = {
        ...check,
        revision: 2,
        result: { kind: 'not_applicable', reason: 'Lid was replaced' },
        progress: 'recorded',
      };
      const changed = await transaction.run(database.ownerId, async (unit) => ({
        success: true as const,
        data: {
          accepted: await unit.evidence.updateCheck(updated, 1),
          replay: await unit.evidence.updateCheck(updated, 1),
          check: await unit.evidence.getCheck(check.id),
        },
      }));
      expect(changed.data).toEqual({
        accepted: true,
        replay: false,
        check: { ...updated, observationIds: [observation.id, voice.id] },
      });
      const foreign = await transaction.run(randomUUID(), async (unit) => ({
        success: true as const,
        data: {
          anchor: await unit.evidence.getAnchor(anchor.id),
          anchors: await unit.evidence.queryAnchorsByAsset(assetId),
          changed: await unit.evidence.updateCheck(
            { ...updated, revision: 3 },
            2,
          ),
        },
      }));
      expect(foreign.data).toEqual({
        anchor: null,
        anchors: [],
        changed: false,
      });
      const withoutNewSupport = await transaction.run(
        database.ownerId,
        async (unit) => ({
          success: true as const,
          data: {
            accepted: await unit.evidence.updateCheck(
              {
                ...updated,
                revision: 3,
                observationIds: [],
                evidenceAnchorIds: [],
              },
              2,
            ),
            check: await unit.evidence.getCheck(check.id),
          },
        }),
      );
      expect(withoutNewSupport.data).toEqual({
        accepted: true,
        check: {
          ...updated,
          revision: 3,
          observationIds: [observation.id, voice.id],
        },
      });
    } finally {
      await database.close();
    }
  });

  it('should paginate current observations with stable timestamp ties and preserve empty pages', async () => {
    const database = await createIsolatedDatabase();
    const transaction = createTransactionPort(database.db);
    const recordId = randomUUID();
    const ids = [randomUUID(), randomUUID(), randomUUID()].sort().reverse();
    const observations: Observation[] = ids.map((id) => ({
      id,
      recordId,
      componentIds: [],
      channel: 'typed',
      text: id,
      evidenceAnchorIds: [],
      checkIds: [],
      observedAt: now,
      voice: null,
      editDraftId: null,
      supersedesObservationId: null,
      author: 'collector',
      createdAt: now,
      supersededByObservationId: null,
    }));
    try {
      await transaction.run(database.ownerId, async (unit) => {
        await unit.records.create({
          id: recordId,
          code: await unit.records.allocateCode(),
          name: null,
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
          description: '',
          collectorJudgment: null,
          condition: null,
          recordRevision: 1,
          analysisInputVersion: 1,
          evidenceVersion: 1,
          createdAt: now,
          updatedAt: now,
          mediaIds: [],
          checkIds: [],
          latestRunId: null,
          analysisFreshness: 'unanalyzed',
        });
        for (const observation of observations) {
          await unit.evidence.addObservation(observation);
        }

        return { success: true as const, data: undefined };
      });
      const first = await transaction.run(database.ownerId, async (unit) => ({
        success: true as const,
        data: await unit.evidence.queryObservations(recordId, undefined, 2),
      }));
      expect(first.data).toEqual({
        items: observations.slice(0, 2),
        nextCursor: expect.any(String),
      });
      const second = await transaction.run(database.ownerId, async (unit) => ({
        success: true as const,
        data: await unit.evidence.queryObservations(
          recordId,
          first.data.nextCursor!,
          2,
        ),
      }));
      expect(second.data).toEqual({
        items: observations.slice(2),
        nextCursor: null,
      });
      const empty = await transaction.run(database.ownerId, async (unit) => ({
        success: true as const,
        data: await unit.evidence.queryObservations(randomUUID()),
      }));
      expect(empty.data).toEqual({ items: [], nextCursor: null });
    } finally {
      await database.close();
    }
  });

  it('should persist observation supersession and check revisions without exposing another owner', async () => {
    const database = await createIsolatedDatabase();
    const transaction = createTransactionPort(database.db);
    const ownerId = database.ownerId;
    const otherOwnerId = randomUUID();
    const recordId = randomUUID();
    const observation: Observation = {
      id: randomUUID(),
      recordId,
      componentIds: [],
      channel: 'typed',
      text: 'Collector first observation',
      evidenceAnchorIds: [],
      checkIds: [],
      observedAt: now,
      voice: null,
      editDraftId: null,
      supersedesObservationId: null,
      author: 'collector',
      createdAt: now,
      supersededByObservationId: null,
    };
    const replacement: Observation = {
      ...observation,
      id: randomUUID(),
      text: 'Collector correction',
      supersedesObservationId: observation.id,
    };
    const check: RecordCheck = {
      id: randomUUID(),
      recordId,
      componentIds: [],
      methodId: randomUUID(),
      methodVersionId: randomUUID(),
      suggestedByRunId: null,
      revision: 1,
      progress: 'not_started',
      result: { kind: 'unrecorded' },
      observationIds: [],
      evidenceAnchorIds: [],
      pendingActionIds: [],
      createdAt: now,
      updatedAt: now,
    };

    try {
      await transaction.run(ownerId, async (unit) => {
        const record: RecordDetail = {
          id: recordId,
          code: await unit.records.allocateCode(),
          name: null,
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
          description: '',
          collectorJudgment: null,
          condition: null,
          recordRevision: 1,
          analysisInputVersion: 1,
          evidenceVersion: 1,
          createdAt: now,
          updatedAt: now,
          mediaIds: [],
          checkIds: [],
          latestRunId: null,
          analysisFreshness: 'unanalyzed',
        };
        await unit.records.create(record);
        await unit.evidence.addObservation(observation);
        await unit.evidence.addCheck(check);

        return { success: true as const, data: undefined };
      });
      const initial = await transaction.run(ownerId, async (unit) => ({
        success: true as const,
        data: {
          observation: await unit.evidence.getObservation(observation.id),
          check: await unit.evidence.findActiveCheck(
            recordId,
            check.methodVersionId,
            [],
          ),
          page: await unit.evidence.queryObservations(recordId, undefined, 1),
        },
      }));
      expect(initial.data).toEqual({
        observation,
        check,
        page: { items: [observation], nextCursor: null },
      });
      const foreign = await transaction.run(otherOwnerId, async (unit) => ({
        success: true as const,
        data: {
          observation: await unit.evidence.getObservation(observation.id),
          check: await unit.evidence.getCheck(check.id),
          page: await unit.evidence.queryObservations(recordId),
          active: await unit.evidence.findActiveCheck(
            recordId,
            check.methodVersionId,
            [],
          ),
        },
      }));
      expect(foreign.data).toEqual({
        observation: null,
        check: null,
        page: { items: [], nextCursor: null },
        active: null,
      });

      const changed = await transaction.run(ownerId, async (unit) => {
        await unit.evidence.addObservation(replacement);
        await unit.evidence.supersedeObservation(
          observation.id,
          replacement.id,
        );
        const stale = await unit.evidence.updateCheck(
          {
            ...check,
            revision: 2,
            progress: 'recorded',
            result: { kind: 'present' },
            observationIds: [replacement.id],
          },
          2,
        );
        const updated = await unit.evidence.updateCheck(
          {
            ...check,
            revision: 2,
            progress: 'recorded',
            result: { kind: 'present' },
            observationIds: [replacement.id],
          },
          1,
        );

        return {
          success: true as const,
          data: {
            stale,
            updated,
            old: await unit.evidence.getObservation(observation.id),
            current: await unit.evidence.queryObservations(recordId),
            check: await unit.evidence.getCheck(check.id),
          },
        };
      });
      expect(changed.data).toEqual({
        stale: false,
        updated: true,
        old: { ...observation, supersededByObservationId: replacement.id },
        current: {
          items: [{ ...replacement, checkIds: [check.id] }],
          nextCursor: null,
        },
        check: {
          ...check,
          revision: 2,
          progress: 'recorded',
          result: { kind: 'present' },
          observationIds: [replacement.id],
        },
      });
      await expect(
        transaction.run(ownerId, async (unit) => {
          await unit.evidence.supersedeObservation(
            observation.id,
            randomUUID(),
          );

          return { success: true as const, data: undefined };
        }),
      ).rejects.toThrow('Observation already superseded');
    } finally {
      await database.close();
    }
  });
});
