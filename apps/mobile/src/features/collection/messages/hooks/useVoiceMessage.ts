import { useQuery, useQueryClient } from '@tanstack/react-query';

import { randomUUID } from 'expo-crypto';
import { useEffect, useState } from 'react';

import { recordDetailSchema } from '@antica/contracts';

import { uploadMedia } from '../../../../adapters/media-upload';
import {
  finishedJobStates,
  jobStatusQuery,
  requestTranscription,
  transcriptionQuery,
} from '../../../../adapters/transcription';
import { useVoiceRecorder } from '../../../../hooks/useVoiceRecorder';

import { recordQuery } from '../../api/record-query';

import type { ApiTransport } from '@antica/client';
import type { TranscriptionDetail } from '@antica/contracts';

/** where a spoken message stands on its way into the composer */
export type VoiceMessagePhase =
  'idle' | 'recording' | 'transcribing' | 'ready' | 'failed';

/** recording and transcription of one spoken message */
export interface VoiceMessage {
  phase: VoiceMessagePhase;
  /** the transcription the composer text came from, until the message is sent or recorded again */
  transcription: TranscriptionDetail | null;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  /** forgets the transcription once its message has been sent */
  reset: () => void;
}

/** what the voice flow needs from the screen around it */
export interface VoiceMessageOptions {
  api: ApiTransport;
  recordId: string;
  /** receives the transcribed words for the collector to review */
  onTranscript: (text: string) => void;
  /** receives the failure of an upload or transcription request */
  onError: (cause: unknown) => void;
  /** reports microphone permission refusal */
  onPermissionDenied: () => void;
}

/**
 * records a spoken message, uploads it to the record, and transcribes it with the capture flow
 * @param options API transport, record, and the callbacks that receive text and errors
 * @param options.api authenticated API transport
 * @param options.recordId record the recording belongs to
 * @param options.onTranscript receives the transcribed words for review
 * @param options.onError receives an upload or transcription failure
 * @param options.onPermissionDenied reports that the microphone was refused
 * @returns the voice phase, its transcription, and the recording actions
 */
export function useVoiceMessage({
  api,
  recordId,
  onTranscript,
  onError,
  onPermissionDenied,
}: VoiceMessageOptions): VoiceMessage {
  const queryClient = useQueryClient();
  const recorder = useVoiceRecorder();
  const [uploading, setUploading] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [transcriptionId, setTranscriptionId] = useState<string | null>(null);
  const job = useQuery(jobStatusQuery(api, jobId));
  const detail = useQuery(
    transcriptionQuery(
      api,
      transcriptionId,
      Boolean(transcriptionId) &&
        finishedJobStates.includes(job.data?.state.kind ?? ''),
    ),
  );
  const transcription = detail.data?.result ? detail.data : null;

  useEffect(() => {
    const result = transcription?.result;
    if (result) {
      onTranscript(result.readingTextZhHant || result.originalText);
    }
  }, [transcription?.result]);

  const failed =
    job.data?.state.kind === 'failed' ||
    Boolean(job.error) ||
    Boolean(detail.error);
  const phase: VoiceMessagePhase = recorder.recording
    ? 'recording'
    : uploading
      ? 'transcribing'
      : !transcriptionId
        ? 'idle'
        : failed
          ? 'failed'
          : transcription
            ? 'ready'
            : 'transcribing';

  const reset = (): void => {
    setJobId(null);
    setTranscriptionId(null);
  };

  const start = async (): Promise<void> => {
    reset();
    if (!(await recorder.start())) {
      onPermissionDenied();
    }
  };

  const stop = async (): Promise<void> => {
    const uri = await recorder.stop();
    if (!uri) {
      return;
    }
    setUploading(true);
    try {
      const assetId = await uploadMedia(
        api,
        {
          id: randomUUID(),
          uri,
          name: 'voice-message.m4a',
          mimeType: 'audio/mp4',
          kind: 'audio',
          purpose: 'voice_note',
          componentLabel: '',
          state: 'local',
          assetId: null,
        },
        { kind: 'record', id: recordId },
        [],
      );
      const current = await api.get(
        `/v1/records/${encodeURIComponent(recordId)}`,
        recordDetailSchema,
      );
      queryClient.setQueryData(recordQuery(api, recordId).queryKey, current);
      const accepted = await requestTranscription(api, current, assetId);
      setJobId(accepted.jobId);
      setTranscriptionId(accepted.transcriptionId);
    } catch (cause) {
      onError(cause);
    } finally {
      setUploading(false);
    }
  };

  return {
    phase,
    transcription: failed ? null : transcription,
    start,
    stop,
    reset,
  };
}
