import { and, eq, isNull } from 'drizzle-orm';

import { transcriptionDetailSchema } from '@antica/contracts';

import {
  jobs,
  mediaAssets,
  records,
  transcriptionRuns,
} from '../schema/index.js';

import type {
  TranscriptionRepository,
  TranscriptionRunRecord,
} from '@antica/application/ports';
import type { Transaction } from '../transaction.js';

function iso(value: string): string {
  return new Date(value).toISOString();
}

/**
 * persists immutable transcription inputs and first-write provider output
 */
export function createTranscriptionRepository(
  tx: Transaction,
  ownerId: string,
): TranscriptionRepository {
  async function get(id: string): Promise<TranscriptionRunRecord | null> {
    const [row] = await tx
      .select()
      .from(transcriptionRuns)
      .where(
        and(
          eq(transcriptionRuns.id, id),
          eq(transcriptionRuns.ownerId, ownerId),
        ),
      );
    if (!row) {
      return null;
    }

    return {
      detail: transcriptionDetailSchema.parse({
        transcriptionId: row.id,
        jobId: row.jobId,
        revision: row.revision,
        status: row.status,
        snapshot: row.snapshot,
        result: row.result,
        invocation: row.invocation,
        confirmedObservationId: row.confirmedObservationId,
        createdAt: iso(row.createdAt),
        updatedAt: iso(row.updatedAt),
      }),
      request: row.request as TranscriptionRunRecord['request'],
      modelSelection:
        row.modelSelection as TranscriptionRunRecord['modelSelection'],
    };
  }

  return {
    get,
    async create(run) {
      const { detail, request } = run;
      if (
        detail.status !== 'pending' ||
        detail.revision !== 1 ||
        detail.result !== null ||
        detail.invocation !== null ||
        detail.confirmedObservationId !== null ||
        detail.snapshot.recordId !== request.recordId ||
        detail.snapshot.audioAssetId !== request.audioAssetId ||
        detail.snapshot.recordRevision !== request.expectedRecordRevision
      ) {
        throw new Error('Transcription run input is inconsistent');
      }

      const [[job], [record], [audio]] = await Promise.all([
        tx
          .select({ id: jobs.id })
          .from(jobs)
          .where(
            and(
              eq(jobs.id, detail.jobId),
              eq(jobs.ownerId, ownerId),
              eq(jobs.kind, 'transcription'),
              eq(jobs.resourceId, detail.transcriptionId),
            ),
          ),
        tx
          .select({ id: records.id })
          .from(records)
          .where(
            and(
              eq(records.id, detail.snapshot.recordId),
              eq(records.ownerId, ownerId),
            ),
          ),
        tx
          .select({ id: mediaAssets.id, sha256: mediaAssets.sha256 })
          .from(mediaAssets)
          .where(
            and(
              eq(mediaAssets.id, detail.snapshot.audioAssetId),
              eq(mediaAssets.ownerId, ownerId),
              eq(mediaAssets.recordId, detail.snapshot.recordId),
              eq(mediaAssets.kind, 'audio'),
            ),
          ),
      ]);
      if (
        !job ||
        !record ||
        !audio ||
        audio.sha256 !== detail.snapshot.audioSha256
      ) {
        throw new Error('Transcription dependencies are inaccessible');
      }

      await tx.insert(transcriptionRuns).values({
        id: detail.transcriptionId,
        ownerId,
        jobId: detail.jobId,
        recordId: detail.snapshot.recordId,
        audioAssetId: detail.snapshot.audioAssetId,
        revision: detail.revision,
        status: detail.status,
        snapshot: detail.snapshot,
        request,
        modelSelection: run.modelSelection,
        result: null,
        invocation: null,
        confirmedObservationId: null,
        createdAt: detail.createdAt,
        updatedAt: detail.updatedAt,
      });
    },
    async saveResult(id, result, invocation, expectedRevision, updatedAt) {
      const [run] = await tx
        .select({
          recordId: transcriptionRuns.recordId,
          audioAssetId: transcriptionRuns.audioAssetId,
        })
        .from(transcriptionRuns)
        .where(
          and(
            eq(transcriptionRuns.id, id),
            eq(transcriptionRuns.ownerId, ownerId),
          ),
        );
      if (
        !run ||
        result.transcriptionId !== id ||
        result.recordId !== run.recordId ||
        result.audioAssetId !== run.audioAssetId
      ) {
        return false;
      }
      const [changed] = await tx
        .update(transcriptionRuns)
        .set({
          result,
          invocation,
          status: 'ready',
          revision: expectedRevision + 1,
          updatedAt,
        })
        .where(
          and(
            eq(transcriptionRuns.id, id),
            eq(transcriptionRuns.ownerId, ownerId),
            eq(transcriptionRuns.revision, expectedRevision),
            eq(transcriptionRuns.status, 'pending'),
            isNull(transcriptionRuns.result),
            isNull(transcriptionRuns.invocation),
          ),
        )
        .returning({ id: transcriptionRuns.id });

      return Boolean(changed);
    },
    async confirm(id, expectedRevision, observationId, updatedAt) {
      const [changed] = await tx
        .update(transcriptionRuns)
        .set({
          confirmedObservationId: observationId,
          status: 'confirmed',
          revision: expectedRevision + 1,
          updatedAt,
        })
        .where(
          and(
            eq(transcriptionRuns.id, id),
            eq(transcriptionRuns.ownerId, ownerId),
            eq(transcriptionRuns.revision, expectedRevision),
            eq(transcriptionRuns.status, 'ready'),
            isNull(transcriptionRuns.confirmedObservationId),
          ),
        )
        .returning({ id: transcriptionRuns.id });
      if (!changed) {
        return null;
      }

      return (await get(id))!.detail;
    },
  };
}
