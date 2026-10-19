import {
  editDraftDetailSchema,
  jobStatusEnvelopeSchema,
  locationsSchema,
  transcriptionDetailSchema,
} from '@antica/contracts';

import type { UseQueryOptions } from '@tanstack/react-query';

import type { ApiTransport } from '@antica/client';
import type {
  EditDraftDetail,
  JobEnvelope,
  Location,
  TranscriptionDetail,
} from '@antica/contracts';

/**
 * describes the collector's saved storage locations
 * @param api authenticated API transport
 * @returns query options for the location list
 */
export function locationsQuery(api: ApiTransport): UseQueryOptions<Location[]> {
  return {
    queryKey: ['locations'],
    queryFn: async ({ signal }) =>
      api.get('/v1/locations', locationsSchema, signal),
  };
}

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
        ? 3000
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
 * describes an edit draft and its proposed record changes
 * @param api authenticated API transport
 * @param editDraftId edit draft resource, or null before one is requested
 * @param enabled whether its job has produced a result
 * @returns query options for the edit draft detail
 */
export function editDraftQuery(
  api: ApiTransport,
  editDraftId: string | null,
  enabled: boolean,
): UseQueryOptions<EditDraftDetail> {
  return {
    queryKey: ['edit-draft', editDraftId],
    enabled,
    queryFn: async ({ signal }) =>
      api.get(`/v1/edit-drafts/${editDraftId}`, editDraftDetailSchema, signal),
  };
}
