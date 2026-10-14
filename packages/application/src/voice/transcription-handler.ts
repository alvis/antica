import { createHash } from 'node:crypto';

import { transcriptionResultSchema } from '@antica/contracts';

import type {
  ClockPort,
  ModelCatalogPort,
  OperationResult,
  TransactionPort,
  TranscriptionPort,
  TranscriptionRunRecord,
} from '../ports/index.js';

export interface TranscriptionMediaReader {
  read(
    key: string,
  ): Promise<{ readonly bytes: Uint8Array; readonly mimeType: string }>;
}

/**
 * creates a worker that stores transcription results without adopting their text
 * @param transaction provides owner-scoped transcription and job updates
 * @param model transcribes the verified frozen audio
 * @param catalog resolves an audio-capable structured-output model
 * @param media reads the original audio bytes for hash verification
 * @param clock timestamps saved results and completed jobs
 * @returns handler for an owner and job ID that reports completion or a typed transcription failure
 */
export function createTranscriptionHandler(
  transaction: TransactionPort,
  model: TranscriptionPort,
  catalog: ModelCatalogPort,
  media: TranscriptionMediaReader,
  clock: ClockPort,
): (ownerId: string, jobId: string) => Promise<OperationResult<void>> {
  return async (ownerId, jobId) => {
    const prepared = await transaction.run<
      OperationResult<{
        readonly run: TranscriptionRunRecord;
        readonly mimeType: string;
      }>
    >(ownerId, async (unit) => {
      const job = await unit.jobs.get(jobId);
      if (!job || job.kind !== 'transcription') {
        return failure('NOT_FOUND', 'Transcription job not found');
      }
      const run = await unit.transcriptions.get(job.resourceId);
      if (!run) {
        return failure('NOT_FOUND', 'Transcription not found');
      }
      const asset = await unit.media.get(run.detail.snapshot.audioAssetId);
      if (
        !asset ||
        asset.sha256 !== run.detail.snapshot.audioSha256 ||
        asset.state !== 'ready'
      ) {
        return failure(
          'EVIDENCE_INVALID',
          'Frozen audio original is unavailable',
        );
      }

      return { success: true, data: { run, mimeType: asset.mimeType } };
    });
    if (!prepared.success) {
      return prepared;
    }
    const { run, mimeType } = prepared.data;
    if (run.detail.result) {
      return { success: true, data: undefined };
    }
    const capability = await catalog.resolve(run.modelSelection, {
      audioInput: true,
      structuredOutput: true,
    });
    if (!capability.success) {
      return capability;
    }
    const audio = await media.read(
      `originals/${run.detail.snapshot.audioAssetId}`,
    );
    if (
      audio.mimeType !== mimeType ||
      createHash('sha256').update(audio.bytes).digest('hex') !==
        run.detail.snapshot.audioSha256
    ) {
      return failure('EVIDENCE_INVALID', 'Audio bytes changed after request');
    }
    const modeled = await model.transcribe(
      run.request,
      audio,
      run.modelSelection,
    );
    if (!modeled.success) {
      return modeled;
    }
    const parsed = transcriptionResultSchema.safeParse(modeled.data.value);
    if (
      !parsed.success ||
      parsed.data.transcriptionId !== run.detail.transcriptionId ||
      parsed.data.recordId !== run.detail.snapshot.recordId ||
      parsed.data.audioAssetId !== run.detail.snapshot.audioAssetId
    ) {
      return failure(
        'VALIDATION_FAILED',
        'Transcription output does not match its frozen request',
      );
    }

    return transaction.run<OperationResult<void>>(ownerId, async (unit) => {
      const current = await unit.transcriptions.get(run.detail.transcriptionId);
      const job = await unit.jobs.get(jobId);
      if (!current || !job) {
        return failure('NOT_FOUND', 'Transcription job disappeared');
      }
      if (current.detail.result) {
        return { success: true, data: undefined };
      }
      const now = clock.now();
      if (
        !(await unit.transcriptions.saveResult(
          current.detail.transcriptionId,
          parsed.data,
          modeled.data.invocation,
          current.detail.revision,
          now,
        ))
      ) {
        return failure(
          'REVISION_CONFLICT',
          'Transcription changed during save',
        );
      }
      if (
        !(await unit.jobs.update(
          {
            ...job,
            state: { kind: 'succeeded', completedAt: now },
            updatedAt: now,
            result: { transcriptionId: current.detail.transcriptionId },
          },
          job.updatedAt,
        ))
      ) {
        return failure(
          'REVISION_CONFLICT',
          'Transcription job changed during save',
        );
      }

      return { success: true, data: undefined };
    });
  };
}

/**
 * @param code
 * @param message
 */
function failure(
  code:
    | 'NOT_FOUND'
    | 'EVIDENCE_INVALID'
    | 'VALIDATION_FAILED'
    | 'REVISION_CONFLICT',
  message: string,
): OperationResult<never> {
  return {
    success: false,
    error: { code, message, retryable: code === 'REVISION_CONFLICT' },
  };
}
