import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { createDatabase } from '../connection.js';
import { jobs, mediaAssets, records } from '../schema/index.js';

import { createTranscriptionRepository } from './transcripts.js';

import type {
  ModelInvocation,
  TranscriptionRunRecord,
} from '@antica/application/ports';
import type { TranscriptionResult } from '@antica/contracts';

import type { Transaction } from '../transaction.js';

const databaseUrl = process.env.ANTICA_TEST_DATABASE_URL ?? '';
if (!databaseUrl) {
  throw new Error(
    'ANTICA_TEST_DATABASE_URL must identify an isolated migrated database',
  );
}
const rollback = new Error('Rollback transcription test transaction');

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

describe('fn:createTranscriptionRepository', () => {
  it('should persist frozen audio input and accept provider output and confirmation only once per revision', async () => {
    await inRolledBackTransaction(async (tx) => {
      const ownerId = randomUUID();
      const recordId = randomUUID();
      const audioAssetId = randomUUID();
      const transcriptionId = randomUUID();
      const jobId = randomUUID();
      const observationId = randomUUID();
      const now = '2026-10-13T04:00:00.000Z';
      const sha256 = 'a'.repeat(64);
      await tx.insert(records).values({
        id: recordId,
        ownerId,
        code: `TEST-${recordId}`,
        unitKind: 'single',
      });
      await tx.insert(jobs).values({
        id: jobId,
        ownerId,
        kind: 'transcription',
        resourceId: transcriptionId,
        state: 'queued',
        stage: 'transcribe',
      });
      await tx.insert(mediaAssets).values({
        id: audioAssetId,
        ownerId,
        recordId,
        kind: 'audio',
        purpose: 'record_audio',
        state: 'ready',
        objectKey: `originals/${audioAssetId}`,
        originalFileName: 'note.wav',
        mimeType: 'audio/wav',
        byteLength: 12,
        sha256,
      });
      const run: TranscriptionRunRecord = {
        detail: {
          transcriptionId,
          jobId,
          revision: 1,
          status: 'pending',
          snapshot: {
            recordId,
            recordRevision: 1,
            audioAssetId,
            audioSha256: sha256,
            createdAt: now,
          },
          result: null,
          invocation: null,
          confirmedObservationId: null,
          createdAt: now,
          updatedAt: now,
        },
        request: {
          requestKey: transcriptionId,
          recordId,
          audioAssetId,
          expectedRecordRevision: 1,
          vocabularyHints: ['glaze'],
        },
        modelSelection: {
          role: 'transcription',
          modelId: 'development:transcription',
          profileVersion: '1',
        },
      };
      const result: TranscriptionResult = {
        transcriptionId,
        recordId,
        audioAssetId,
        originalText: 'Rough surface',
        readingTextZhHant: '表面粗糙',
        detectedLanguages: ['en'],
        uncertainTerms: [],
        segments: [],
      };
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
      const repository = createTranscriptionRepository(tx, ownerId);
      const foreign = createTranscriptionRepository(tx, randomUUID());

      expect(await repository.get(transcriptionId)).toBeNull();
      await expect(
        repository.create({
          ...run,
          detail: { ...run.detail, status: 'ready' },
        }),
      ).rejects.toThrow(/inconsistent/i);
      await expect(foreign.create(run)).rejects.toThrow(/inaccessible/i);
      await repository.create(run);
      expect(await repository.get(transcriptionId)).toEqual(run);
      expect(await foreign.get(transcriptionId)).toBeNull();
      expect(
        await foreign.saveResult(transcriptionId, result, invocation, 1, now),
      ).toBe(false);
      expect(
        await repository.saveResult(
          transcriptionId,
          result,
          invocation,
          1,
          now,
        ),
      ).toBe(true);
      expect(
        await repository.saveResult(
          transcriptionId,
          result,
          invocation,
          1,
          now,
        ),
      ).toBe(false);
      expect((await repository.get(transcriptionId))?.detail).toMatchObject({
        status: 'ready',
        revision: 2,
        result,
        invocation,
      });
      expect(
        await repository.confirm(transcriptionId, 1, observationId, now),
      ).toBeNull();
      expect(
        await repository.confirm(transcriptionId, 2, observationId, now),
      ).toMatchObject({
        status: 'confirmed',
        revision: 3,
        confirmedObservationId: observationId,
      });
      expect(
        await repository.confirm(transcriptionId, 2, observationId, now),
      ).toBeNull();
      expect((await repository.get(transcriptionId))?.detail).toMatchObject({
        status: 'confirmed',
        result,
        invocation,
        confirmedObservationId: observationId,
      });
    });
  });
});
