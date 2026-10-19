import { randomUUID } from 'expo-crypto';
import { useEffect, useState } from 'react';

import {
  observationInputSchema,
  observationSchema,
  recordDetailSchema,
  transcriptionConfirmSchema,
  transcriptionConfirmedSchema,
} from '@antica/contracts';

import type { QueryClient } from '@tanstack/react-query';

import type { Dispatch, SetStateAction } from 'react';

import type { TranscriptionConfirm } from '@antica/contracts';

import type { CaptureDraftState, CaptureRuntime } from './useCaptureDraft';
import type { CaptureJobs } from './useCaptureJobs';

/** the collector's confirmed original words */
export interface CaptureObservation {
  savedObservation: boolean;
  confirmedObservationId: string | null;
  setConfirmRequest: Dispatch<SetStateAction<TranscriptionConfirm | null>>;
  confirmWords: () => Promise<void>;
}

/**
 * confirms the original words as an observation, typed or from a transcription
 * @param runtime API transport, translations, and shared busy/error status
 * @param context draft state, transcription jobs, and the capture route
 * @param context.draft record, media, and words collected so far
 * @param context.update capture draft patcher
 * @param context.jobs transcription and edit-draft jobs
 * @param context.checkId check the capture answers, when opened from one
 * @param context.queryClient query cache to refresh after confirming
 * @returns confirmation state and the confirm action
 */
export function useCaptureObservation(
  runtime: CaptureRuntime,
  {
    draft,
    update,
    jobs,
    checkId,
    queryClient,
  }: Pick<CaptureDraftState, 'draft' | 'update'> & {
    jobs: Pick<CaptureJobs, 'transcriptionResourceId' | 'transcriptionDetail'>;
    checkId: string | undefined;
    queryClient: QueryClient;
  },
): CaptureObservation {
  const { api, t, busy, setBusy, setError } = runtime;
  const { transcriptionResourceId, transcriptionDetail } = jobs;
  const [savedObservation, setSavedObservation] = useState(false);
  const [observationKey] = useState(randomUUID);
  const [observationTime] = useState(() => new Date().toISOString());
  const [confirmedObservationId, setConfirmedObservationId] = useState<
    string | null
  >(null);
  const [confirmRequest, setConfirmRequest] =
    useState<TranscriptionConfirm | null>(null);

  useEffect(() => {
    const id = transcriptionDetail.data?.confirmedObservationId;
    if (id) {
      setConfirmedObservationId(id);
      setSavedObservation(true);
    }
  }, [transcriptionDetail.data?.confirmedObservationId]);

  const confirmWords = async (): Promise<void> => {
    if (
      !draft.record ||
      !draft.originalWords.trim() ||
      savedObservation ||
      busy
    ) {
      return;
    }
    setBusy(true);
    setError('');
    try {
      const current = await api.get(
        `/v1/records/${draft.record.id}`,
        recordDetailSchema,
      );
      if (transcriptionResourceId) {
        const detail = transcriptionDetail.data;
        if (!detail || detail.status !== 'ready') {
          throw new Error(t('processing'));
        }
        const request =
          confirmRequest ??
          transcriptionConfirmSchema.parse({
            requestKey: randomUUID(),
            expectedRevision: detail.revision,
            expectedRecordRevision: current.recordRevision,
            adoptedTextZhHant: draft.originalWords.trim(),
            componentIds: [],
            evidenceAnchorIds: [],
            checkIds: checkId ? [checkId] : [],
            observedAt: observationTime,
          });
        setConfirmRequest(request);
        const confirmed = await api.post(
          `/v1/transcriptions/${transcriptionResourceId}/confirm`,
          transcriptionConfirmedSchema,
          { body: request, idempotencyKey: request.requestKey },
        );
        setConfirmedObservationId(confirmed.observation.id);
        await transcriptionDetail.refetch();
      } else {
        const observation = observationInputSchema.parse({
          recordId: current.id,
          componentIds: [],
          channel: 'typed',
          text: draft.originalWords.trim(),
          evidenceAnchorIds: [],
          checkIds: checkId ? [checkId] : [],
          observedAt: observationTime,
          voice: null,
          editDraftId: null,
          supersedesObservationId: null,
        });
        const created = await api.post('/v1/observations', observationSchema, {
          body: observation,
          idempotencyKey: observationKey,
        });
        setConfirmedObservationId(created.id);
      }
      setSavedObservation(true);

      await queryClient.invalidateQueries({
        queryKey: ['observations', current.id],
      });
      update({
        record: await api.get(`/v1/records/${current.id}`, recordDetailSchema),
      });
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return {
    savedObservation,
    confirmedObservationId,
    setConfirmRequest,
    confirmWords,
  };
}
