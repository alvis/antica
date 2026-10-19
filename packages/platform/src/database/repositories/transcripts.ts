import { transcriptionDetailSchema } from '@antica/contracts';

import { Prisma } from '../generated/client.js';
import { jsonValue, nullableJson } from '../json.js';

import type {
  TranscriptionRepository,
  TranscriptionRunRecord,
} from '@antica/application/ports';

import type { Transaction } from '../transaction.js';

/** @param value */
function iso(value: string | Date): string {
  return new Date(value).toISOString();
}

/**
 * persists immutable transcription inputs and first-write provider output
 * @param tx
 * @param ownerId
 */
export function createTranscriptionRepository(
  tx: Transaction,
  ownerId: string,
): TranscriptionRepository {
  async function get(id: string): Promise<TranscriptionRunRecord | null> {
    const [row] = await tx.transcriptionRuns.findMany({
      where: { AND: [{ id }, { ownerId }] },
    });
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
    /** @param run */
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
        tx.jobs.findMany({
          select: { id: true },
          where: {
            AND: [
              { id: detail.jobId },
              { ownerId },
              { kind: 'transcription' },
              { resourceId: detail.transcriptionId },
            ],
          },
        }),
        tx.records.findMany({
          select: { id: true },
          where: { AND: [{ id: detail.snapshot.recordId }, { ownerId }] },
        }),
        tx.mediaAssets.findMany({
          select: { id: true, sha256: true },
          where: {
            AND: [
              { id: detail.snapshot.audioAssetId },
              { ownerId },
              { recordId: detail.snapshot.recordId },
              { kind: 'audio' },
            ],
          },
        }),
      ]);
      if (
        !job ||
        !record ||
        !audio ||
        audio.sha256 !== detail.snapshot.audioSha256
      ) {
        throw new Error('Transcription dependencies are inaccessible');
      }

      await tx.transcriptionRuns.createMany({
        data: {
          id: detail.transcriptionId,
          ownerId,
          jobId: detail.jobId,
          recordId: detail.snapshot.recordId,
          audioAssetId: detail.snapshot.audioAssetId,
          revision: detail.revision,
          status: detail.status,
          snapshot: jsonValue(detail.snapshot),
          request: jsonValue(request),
          modelSelection: jsonValue(run.modelSelection),
          result: nullableJson(null),
          invocation: nullableJson(null),
          confirmedObservationId: null,
          createdAt: detail.createdAt,
          updatedAt: detail.updatedAt,
        },
      });
    },
    /**
     * @param id
     * @param result
     * @param invocation
     * @param expectedRevision
     * @param updatedAt
     */
    async saveResult(id, result, invocation, expectedRevision, updatedAt) {
      const [run] = await tx.transcriptionRuns.findMany({
        select: { recordId: true, audioAssetId: true },
        where: { AND: [{ id }, { ownerId }] },
      });
      if (
        !run ||
        result.transcriptionId !== id ||
        result.recordId !== run.recordId ||
        result.audioAssetId !== run.audioAssetId
      ) {
        return false;
      }
      const [changed] = await tx.transcriptionRuns.updateManyAndReturn({
        data: {
          result: nullableJson(result),
          invocation: nullableJson(invocation),
          status: 'ready',
          revision: expectedRevision + 1,
          updatedAt,
        },
        select: { id: true },
        where: {
          AND: [
            { id },
            { ownerId },
            { revision: expectedRevision },
            { status: 'pending' },
            { result: { equals: Prisma.DbNull } },
            { invocation: { equals: Prisma.DbNull } },
          ],
        },
      });

      return Boolean(changed);
    },
    /**
     * @param id
     * @param expectedRevision
     * @param observationId
     * @param updatedAt
     */
    async confirm(id, expectedRevision, observationId, updatedAt) {
      const [changed] = await tx.transcriptionRuns.updateManyAndReturn({
        data: {
          confirmedObservationId: observationId,
          status: 'confirmed',
          revision: expectedRevision + 1,
          updatedAt,
        },
        select: { id: true },
        where: {
          AND: [
            { id },
            { ownerId },
            { revision: expectedRevision },
            { status: 'ready' },
            { confirmedObservationId: null },
          ],
        },
      });
      if (!changed) {
        return null;
      }

      return (await get(id))!.detail;
    },
  };
}
