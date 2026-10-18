import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  createEditDraftHandler,
  createEditDraftService,
  createEvidenceService,
  createMediaJobHandler,
  createMediaService,
  createRecordService,
  createTranscriptionHandler,
  createTranscriptionService,
} from '@antica/application/server';
import {
  createDatabase,
  createLocalMediaStore,
  createTransactionPort,
  processImage,
} from '@antica/platform';
import { createDevelopmentModels } from '@antica/platform/ai';

import type {
  ModelInvocation,
  RecordEditingPort,
  TranscriptionPort,
} from '@antica/application/ports';

const databaseUrl = process.env.ANTICA_TEST_DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    'ANTICA_TEST_DATABASE_URL must identify an isolated migrated acceptance database',
  );
}
const clock = { now: (): string => '2026-10-13T00:00:00.000Z' };
const ids = { create: randomUUID };
const invocation: ModelInvocation = {
  requestedModelId: 'acceptance:test-provider',
  effectiveModelId: 'acceptance:test-provider',
  provider: 'acceptance',
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

describe('Persistent collector voice', () => {
  it('should preserve the original transcript and audio while adopting only explicitly confirmed collector text', async () => {
    const database = createDatabase({ url: databaseUrl });
    const root = await mkdtemp(join(tmpdir(), 'antica-voice-'));
    const transaction = createTransactionPort(database.db);
    const ownerId = randomUUID();
    const models = createDevelopmentModels();
    const records = createRecordService(transaction, clock, ids);
    const evidence = createEvidenceService(transaction, clock, ids);
    const store = createLocalMediaStore({
      root,
      publicBaseUrl: 'http://localhost:8080',
      signingSecret: 'acceptance-voice-secret-at-least-32-characters',
    });
    const media = createMediaService(transaction, store, clock, ids);
    const selection = {
      role: 'transcription' as const,
      modelId: 'development:transcription',
      profileVersion: '1',
    };
    const transcripts = createTranscriptionService(
      transaction,
      selection,
      clock,
      ids,
    );
    const transcribe = vi.fn<TranscriptionPort['transcribe']>(
      async (request) => ({
        success: true,
        data: {
          value: {
            transcriptionId: request.requestKey,
            recordId: request.recordId,
            audioAssetId: request.audioAssetId,
            originalText: '摸落去有啲鞋。',
            readingTextZhHant: '摸落去有啲粗糙。',
            detectedLanguages: ['yue'],
            uncertainTerms: ['鞋'],
            segments: [],
          },
          invocation,
        },
      }),
    );
    try {
      const created = await records.create(ownerId, randomUUID(), {
        unitKind: 'single',
      });
      if (!created.success) {
        throw new Error('Record fixture failed');
      }
      const bytes = Buffer.alloc(46);
      bytes.write('RIFF');
      bytes.writeUInt32LE(38, 4);
      bytes.write('WAVEfmt ', 8);
      bytes.writeUInt32LE(16, 16);
      bytes.writeUInt16LE(1, 20);
      bytes.writeUInt16LE(1, 22);
      bytes.writeUInt32LE(8000, 24);
      bytes.writeUInt32LE(16000, 28);
      bytes.writeUInt16LE(2, 32);
      bytes.writeUInt16LE(16, 34);
      bytes.write('data', 36);
      bytes.writeUInt32LE(2, 40);
      const uploaded = await media.start(ownerId, {
        requestKey: randomUUID(),
        target: { kind: 'record', recordId: created.data.id },
        kind: 'audio',
        purpose: 'voice_note',
        componentIds: [],
        fileName: 'voice.wav',
        mimeType: 'audio/wav',
        byteLength: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      });
      if (!uploaded.success || uploaded.data.mode !== 'single') {
        throw new Error('Audio fixture failed');
      }
      await store.acceptUploadToken(
        new URL(uploaded.data.putUrl).pathname.split('/').at(-1)!,
        bytes,
        'audio/wav',
      );
      const complete = await media.complete(
        ownerId,
        uploaded.data.assetId,
        randomUUID(),
      );
      if (!complete.success || !complete.data.processingJobId) {
        throw new Error('Audio job missing');
      }
      expect(
        await createMediaJobHandler(
          transaction,
          { processImage: async (input) => processImage({ ...input, store }) },
          clock,
          ids,
        )(ownerId, complete.data.processingJobId),
      ).toEqual({ success: true, data: undefined });
      const request = {
        requestKey: randomUUID(),
        recordId: created.data.id,
        audioAssetId: uploaded.data.assetId,
        expectedRecordRevision: 1,
        vocabularyHints: ['粗糙'],
      };
      const accepted = await transcripts.submit(ownerId, request);
      if (!accepted.success) {
        throw new Error('Transcription request failed');
      }
      expect(await transcripts.submit(ownerId, request)).toEqual(accepted);
      const handler = createTranscriptionHandler(
        transaction,
        { transcribe },
        models.catalog,
        store,
        clock,
      );
      expect(await handler(ownerId, accepted.data.jobId)).toEqual({
        success: true,
        data: undefined,
      });
      expect(await handler(ownerId, accepted.data.jobId)).toEqual({
        success: true,
        data: undefined,
      });
      expect(transcribe).toHaveBeenCalledTimes(1);
      expect(
        await evidence.observations(ownerId, created.data.id),
      ).toMatchObject({ success: true, data: { items: [] } });
      expect(
        await transcripts.get(randomUUID(), accepted.data.transcriptionId),
      ).toMatchObject({ success: false, error: { code: 'NOT_FOUND' } });
      const confirmation = {
        requestKey: randomUUID(),
        expectedRevision: 2,
        expectedRecordRevision: 1,
        adoptedTextZhHant: '觸感粗糙，尚未判定原因。',
        componentIds: [],
        evidenceAnchorIds: [],
        checkIds: [],
        observedAt: clock.now(),
      };
      const confirmed = await transcripts.confirm(
        ownerId,
        accepted.data.transcriptionId,
        confirmation,
      );
      expect(confirmed).toMatchObject({
        success: true,
        data: {
          transcription: {
            status: 'confirmed',
            result: {
              originalText: '摸落去有啲鞋。',
              readingTextZhHant: '摸落去有啲粗糙。',
            },
          },
          observation: {
            text: confirmation.adoptedTextZhHant,
            voice: {
              audioAssetId: uploaded.data.assetId,
              transcriptionId: accepted.data.transcriptionId,
            },
          },
          versions: {
            recordRevision: 2,
            analysisInputVersion: 2,
            evidenceVersion: 1,
          },
        },
      });
      expect(
        await transcripts.confirm(
          ownerId,
          accepted.data.transcriptionId,
          confirmation,
        ),
      ).toEqual(confirmed);
      expect(
        (await store.read(`originals/${uploaded.data.assetId}`)).bytes,
      ).toEqual(bytes);
      expect(await records.get(ownerId, created.data.id)).toMatchObject({
        success: true,
        data: { description: '', latestRunId: null },
      });
    } finally {
      await database.close();
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('Persistent selective edit adoption', () => {
  it.each([false, true])(
    'should generate from pinned inputs and protect collector fields during adoption (later edit: %s)',
    async (stale) => {
      const database = createDatabase({ url: databaseUrl });
      const transaction = createTransactionPort(database.db);
      const ownerId = randomUUID();
      const models = createDevelopmentModels();
      const records = createRecordService(transaction, clock, ids);
      const evidence = createEvidenceService(transaction, clock, ids);
      const service = createEditDraftService(
        transaction,
        {
          role: 'recordEditing',
          modelId: 'development:evidence-v1',
          profileVersion: '1',
        },
        clock,
        ids,
      );
      const descriptionId = randomUUID();
      const nameId = randomUUID();
      const draft = vi.fn<RecordEditingPort['draft']>(
        async (request, sourceText, context) => ({
          success: true,
          data: {
            value: {
              editDraftId: request.requestKey,
              recordId: request.recordId,
              baseVersions: context.versions,
              sourceTranscriptionIds: request.transcriptionIds,
              sourceObservationIds: request.observationIds,
              replyZhHant: 'Reply',
              suggestedDescriptionZhHant: sourceText.join('\n'),
              proposedChanges: [
                {
                  id: descriptionId,
                  field: 'description',
                  before: context.fields.description,
                  proposed: sourceText.join('\n'),
                  findingIds: [],
                },
                {
                  id: nameId,
                  field: 'name',
                  before: context.fields.name,
                  proposed: 'Generated name',
                  findingIds: [],
                },
              ],
            },
            invocation: { ...invocation, role: 'recordEditing' },
          },
        }),
      );
      try {
        const created = await records.create(ownerId, randomUUID(), {
          unitKind: 'single',
          name: 'Collector name',
          description: 'Original description',
        });
        if (!created.success) {
          throw new Error('Record fixture failed');
        }
        const observed = await evidence.addObservation(ownerId, randomUUID(), {
          recordId: created.data.id,
          componentIds: [],
          channel: 'typed',
          text: '手感粗糙',
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
        const request = {
          requestKey: randomUUID(),
          recordId: created.data.id,
          expectedRecordRevision: 2,
          transcriptionIds: [],
          observationIds: [observed.data.id],
          instructionZhHant: '整理文字',
        };
        const accepted = await service.submit(ownerId, request);
        if (!accepted.success) {
          throw new Error('Edit request failed');
        }
        expect(await service.submit(ownerId, request)).toEqual(accepted);
        if (stale) {
          expect(
            await records.patch(ownerId, created.data.id, randomUUID(), {
              expectedRevision: 2,
              fields: { description: 'New collector correction' },
            }),
          ).toMatchObject({ success: true });
        }
        const handler = createEditDraftHandler(
          transaction,
          { draft },
          models.catalog,
          clock,
          ids,
        );
        expect(await handler(ownerId, accepted.data.jobId)).toEqual({
          success: true,
          data: undefined,
        });
        expect(await handler(ownerId, accepted.data.jobId)).toEqual({
          success: true,
          data: undefined,
        });
        expect(draft).toHaveBeenCalledTimes(1);
        expect(draft.mock.calls[0]?.[2]).toMatchObject({
          fields: { description: 'Original description' },
          versions: { recordRevision: 2 },
        });
        expect(await records.get(ownerId, created.data.id)).toMatchObject({
          success: true,
          data: {
            name: 'Collector name',
            description: stale
              ? 'New collector correction'
              : 'Original description',
          },
        });
        const adoption = {
          requestKey: randomUUID(),
          expectedDraftRevision: 2,
          expectedRecordRevision: stale ? 3 : 2,
          selectedProposalIds: [descriptionId],
        };
        const applied = await service.apply(
          ownerId,
          accepted.data.editDraftId,
          adoption,
        );
        if (stale) {
          expect(applied).toMatchObject({
            success: false,
            error: { code: 'REVISION_CONFLICT' },
          });
        } else {
          expect(applied).toMatchObject({
            success: true,
            data: {
              draft: {
                status: 'partially_applied',
                appliedProposalIds: [descriptionId],
              },
              record: {
                name: 'Collector name',
                description: '手感粗糙',
                recordRevision: 3,
                analysisInputVersion: 3,
              },
            },
          });
          expect(
            await service.apply(ownerId, accepted.data.editDraftId, adoption),
          ).toEqual(applied);
        }
      } finally {
        await database.close();
      }
    },
  );
});
