import { randomUUID } from 'expo-crypto';

import {
  jobStatusEnvelopeSchema,
  transcriptionAcceptedSchema,
  transcriptionDetailSchema,
  transcriptionSubmitSchema,
} from '@antica/contracts';

import type { UseQueryOptions } from '@tanstack/react-query';

import type { ApiTransport } from '@antica/client';
import type {
  JobEnvelope,
  RecordDetail,
  TranscriptionAccepted,
  TranscriptionDetail,
} from '@antica/contracts';

/** how often an unfinished job is reread */
export const jobPollIntervalMs = 3000;

/** job states after which the job's resource holds a result */
export const finishedJobStates: readonly string[] = ['succeeded', 'partial'];

/**
 * describes a background job, polling every 3 seconds while it is unfinished
 * @param api authenticated API transport
 * @param jobId job to follow, or null before one is started
 * @returns query options for the job status
 */
export function jobStatusQuery(
  api: ApiTransport,
  jobId: string | null,
): UseQueryOptions<JobEnvelope> {
  return {
    queryKey: ['job', jobId],
    enabled: Boolean(jobId),
    queryFn: async ({ signal }) =>
      api.get(`/v1/jobs/${jobId}`, jobStatusEnvelopeSchema, signal),
    refetchInterval: (query) =>
      ['queued', 'running', 'waiting'].includes(
        query.state.data?.state.kind ?? '',
      )
        ? jobPollIntervalMs
        : false,
  };
}

/**
 * describes a transcription and its confirmation state
 * @param api authenticated API transport
 * @param transcriptionId transcription resource, or null before one is requested
 * @param enabled whether its job has produced a result
 * @returns query options for the transcription detail
 */
export function transcriptionQuery(
  api: ApiTransport,
  transcriptionId: string | null,
  enabled: boolean,
): UseQueryOptions<TranscriptionDetail> {
  return {
    queryKey: ['transcription', transcriptionId],
    enabled,
    queryFn: async ({ signal }) =>
      api.get(
        `/v1/transcriptions/${transcriptionId}`,
        transcriptionDetailSchema,
        signal,
      ),
  };
}

/**
 * starts transcribing an uploaded voice recording of a record
 * @param api authenticated API transport
 * @param record record the recording belongs to, at its current revision
 * @param audioAssetId uploaded recording
 * @returns the transcription resource and the job producing it
 */
export async function requestTranscription(
  api: ApiTransport,
  record: Pick<RecordDetail, 'id' | 'recordRevision'>,
  audioAssetId: string,
): Promise<TranscriptionAccepted> {
  const request = transcriptionSubmitSchema.parse({
    requestKey: randomUUID(),
    recordId: record.id,
    expectedRecordRevision: record.recordRevision,
    audioAssetId,
    vocabularyHints: [],
  });

  return api.post('/v1/transcriptions', transcriptionAcceptedSchema, {
    body: request,
    idempotencyKey: request.requestKey,
  });
}
