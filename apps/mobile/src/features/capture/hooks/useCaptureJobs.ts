import { useQuery } from '@tanstack/react-query';

import { randomUUID } from 'expo-crypto';
import { getItemAsync, setItemAsync } from 'expo-secure-store';
import { useEffect, useState } from 'react';

import {
  recordDetailSchema,
  transcriptionSubmitSchema,
  transcriptionAcceptedSchema,
} from '@antica/contracts';

import { uploadMedia } from '../../../adapters/media-upload';

import {
  editDraftQuery,
  jobStatusQuery,
  transcriptionQuery,
} from '../api/capture-queries';

import type { UseQueryResult } from '@tanstack/react-query';

import type { Dispatch, SetStateAction } from 'react';

import type {
  EditDraftDetail,
  JobEnvelope,
  TranscriptionDetail,
} from '@antica/contracts';

import type { CaptureDraftState, CaptureRuntime } from './useCaptureDraft';

/** transcription and edit-draft jobs started for the capture record */
export interface CaptureJobs {
  transcriptionJobId: string | null;
  editJobId: string | null;
  setEditJobId: Dispatch<SetStateAction<string | null>>;
  transcriptionResourceId: string | null;
  setEditResourceId: Dispatch<SetStateAction<string | null>>;
  transcription: UseQueryResult<JobEnvelope>;
  editDraft: UseQueryResult<JobEnvelope>;
  transcriptionDetail: UseQueryResult<TranscriptionDetail>;
  editDetail: UseQueryResult<EditDraftDetail>;
  prepareVoice: () => Promise<void>;
}

/**
 * follows the record's transcription and edit-draft jobs, restoring them after a restart
 * @param runtime API transport, translations, and shared busy/error status
 * @param draftState capture draft and its updaters
 * @returns job identifiers, their queries, and the transcription action
 */
export function useCaptureJobs(
  runtime: CaptureRuntime,
  draftState: Pick<CaptureDraftState, 'draft' | 'setDraft' | 'update'>,
): CaptureJobs {
  const { api, busy, setBusy, setError } = runtime;
  const { draft, setDraft, update } = draftState;
  const [transcriptionJobId, setTranscriptionJobId] = useState<string | null>(
    null,
  );
  const [editJobId, setEditJobId] = useState<string | null>(null);
  const [transcriptionResourceId, setTranscriptionResourceId] = useState<
    string | null
  >(null);
  const [editResourceId, setEditResourceId] = useState<string | null>(null);
  const transcription = useQuery(jobStatusQuery(api, transcriptionJobId));
  const editDraft = useQuery(jobStatusQuery(api, editJobId));
  const transcriptionDetail = useQuery(
    transcriptionQuery(
      api,
      transcriptionResourceId,
      Boolean(transcriptionResourceId) &&
        ['succeeded', 'partial'].includes(transcription.data?.state.kind ?? ''),
    ),
  );
  const editDetail = useQuery(
    editDraftQuery(
      api,
      editResourceId,
      Boolean(editResourceId) &&
        ['succeeded', 'partial'].includes(editDraft.data?.state.kind ?? ''),
    ),
  );

  useEffect(() => {
    const id = draft.record?.id;
    if (!id) {
      return;
    }
    let active = true;
    void Promise.all([
      getItemAsync(`antica.transcriptionJob.${id}`),
      getItemAsync(`antica.editJob.${id}`),
      getItemAsync(`antica.transcription.${id}`),
      getItemAsync(`antica.editDraft.${id}`),
    ])
      .then(([transcriptionId, editingId, transcriptId, draftId]) => {
        if (!active) {
          return;
        }
        if (transcriptionId) {
          setTranscriptionJobId((current) => current ?? transcriptionId);
        }
        if (editingId) {
          setEditJobId((current) => current ?? editingId);
        }
        if (transcriptId) {
          setTranscriptionResourceId((current) => current ?? transcriptId);
        }
        if (draftId) {
          setEditResourceId((current) => current ?? draftId);
        }
      })
      .catch((cause: unknown) => {
        setError((cause as Error).message);
      });

    return () => {
      active = false;
    };
  }, [draft.record?.id]);

  useEffect(() => {
    const result = transcriptionDetail.data?.result;
    if (result) {
      setDraft((current) => ({
        ...current,
        transcriptionId: result.transcriptionId,
        originalWords:
          current.originalWords ||
          result.readingTextZhHant ||
          result.originalText,
      }));
    }
  }, [transcriptionDetail.data?.result]);

  const prepareVoice = async (): Promise<void> => {
    const audio = draft.files.find((file) => file.purpose === 'voice_note');
    if (!audio || !draft.record || busy) {
      return;
    }
    setBusy(true);
    setError('');
    try {
      const assetId =
        audio.assetId ??
        (await uploadMedia(
          api,
          audio,
          { kind: 'record', id: draft.record.id },
          [],
        ));
      update({
        files: draft.files.map((file) =>
          file.id === audio.id ? { ...file, assetId, state: 'uploaded' } : file,
        ),
      });
      const current = await api.get(
        `/v1/records/${draft.record.id}`,
        recordDetailSchema,
      );
      update({ record: current });
      const request = transcriptionSubmitSchema.parse({
        requestKey: randomUUID(),
        recordId: current.id,
        expectedRecordRevision: current.recordRevision,
        audioAssetId: assetId,
        vocabularyHints: [],
      });
      const accepted = await api.post(
        '/v1/transcriptions',
        transcriptionAcceptedSchema,
        { body: request, idempotencyKey: request.requestKey },
      );
      setTranscriptionJobId(accepted.jobId);
      setTranscriptionResourceId(accepted.transcriptionId);
      void Promise.all([
        setItemAsync(`antica.transcriptionJob.${current.id}`, accepted.jobId),
        setItemAsync(
          `antica.transcription.${current.id}`,
          accepted.transcriptionId,
        ),
      ]).catch((cause: unknown) => {
        setError((cause as Error).message);
      });
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return {
    transcriptionJobId,
    editJobId,
    setEditJobId,
    transcriptionResourceId,
    setEditResourceId,
    transcription,
    editDraft,
    transcriptionDetail,
    editDetail,
    prepareVoice,
  };
}
