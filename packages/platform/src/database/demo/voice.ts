import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { createJobRepository } from '../repositories/runtime.js';
import { createTranscriptionRepository } from '../repositories/transcripts.js';

import {
  readRecord,
  seedInvocation,
  seedModelSelection,
} from './provenance.js';

import type { DemoApi } from './api.js';
import type { DemoRunContext } from './provenance.js';

/**
 * uploads the designed voice message and stores its seed-authored transcript, without claiming a speech provider ran
 * @param context isolated demo database and collector
 * @param api authenticated upload pipeline
 * @param input record, message and designed timestamp
 * @param input.recordId chair record
 * @param input.text exact collector message
 * @param input.createdAt designed message time
 * @returns ready transcription identifier for the conversation
 */
export async function seedVoiceMessage(
  context: DemoRunContext,
  api: DemoApi,
  input: { recordId: string; text: string; createdAt: string },
): Promise<string> {
  const audioAssetId = await api.upload({
    recordId: input.recordId,
    purpose: 'voice_note',
    fileName: 'chair-message.m4a',
    bytes: await readFile(new URL('audio/chair-message.m4a', import.meta.url)),
  });
  const [media] = await api.waitUntilReady([audioAssetId]);
  if (!media) {
    throw new Error('The demo voice message is unavailable');
  }
  const transcriptionId = randomUUID();
  const jobId = randomUUID();
  const createdAt = new Date(input.createdAt).toISOString();
  await context.db.$transaction(async (tx) => {
    const record = await readRecord(tx, context.ownerId, input.recordId);
    await createJobRepository(tx, context.ownerId).create({
      id: jobId,
      kind: 'transcription',
      resourceId: transcriptionId,
      state: { kind: 'succeeded', completedAt: createdAt },
      createdAt,
      updatedAt: createdAt,
      result: { transcriptionId },
    });
    const repository = createTranscriptionRepository(tx, context.ownerId);
    await repository.create({
      detail: {
        transcriptionId,
        jobId,
        revision: 1,
        status: 'pending',
        snapshot: {
          recordId: record.id,
          recordRevision: record.recordRevision,
          audioAssetId,
          audioSha256: media.asset.sha256,
          createdAt,
        },
        result: null,
        invocation: null,
        confirmedObservationId: null,
        createdAt,
        updatedAt: createdAt,
      },
      request: {
        requestKey: transcriptionId,
        recordId: record.id,
        audioAssetId,
        vocabularyHints: [],
        expectedRecordRevision: record.recordRevision,
      },
      modelSelection: seedModelSelection('transcription'),
    });
    const saved = await repository.saveResult(
      transcriptionId,
      {
        transcriptionId,
        recordId: record.id,
        audioAssetId,
        originalText: input.text,
        readingTextZhHant: input.text,
        detectedLanguages: ['zh-Hant'],
        uncertainTerms: [],
        segments: [
          {
            id: randomUUID(),
            startMs: 0,
            endMs: 14_000,
            originalText: input.text,
          },
        ],
      },
      seedInvocation('transcription'),
      1,
      createdAt,
    );
    if (!saved) {
      throw new Error('The demo voice transcript could not be saved');
    }
  });

  return transcriptionId;
}
