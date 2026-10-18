import { useQueryClient } from '@tanstack/react-query';

import { randomUUID } from 'expo-crypto';
import { useState } from 'react';

import {
  recordMessageBodyMaxLength,
  recordMessagePostSchema,
} from '@antica/contracts';

import { recordQuery } from '../../api/record-query';

import {
  describeMessageError,
  isRevisionConflict,
} from '../api/message-errors';
import { postRecordMessage, recordMessagesKey } from '../api/record-messages';

import { useVoiceMessage } from './useVoiceMessage';

import type { ApiTransport } from '@antica/client';
import type {
  RecordDetail,
  RecordMessagePost,
  TranscriptionDetail,
} from '@antica/contracts';

import type { MessageKey } from '../../../../i18n/messages';

import type { VoiceMessage } from './useVoiceMessage';

/** the text being written, its sending state, and the voice flow that can fill it */
export interface MessageComposer {
  text: string;
  setText: (text: string) => void;
  busy: boolean;
  error: string;
  /** posts the current text; absent while it cannot be sent */
  send?: () => Promise<void>;
  voice: VoiceMessage;
}

/** what the composer needs from the screen around it */
export interface MessageComposerOptions {
  api: ApiTransport;
  recordId: string;
  /** the record as the screen currently shows it */
  record: RecordDetail | undefined;
  t: (key: MessageKey) => string;
}

/**
 * picks the post for this attempt: the unanswered one when it carries the same words and sources, else a new one
 * @param unfinished the post kept from an earlier attempt
 * @param attempt words, ready transcription, and record revision of this attempt
 * @param attempt.transcription the ready transcription the words came from, if any
 * @returns the post to send, with a fresh request key unless it repeats the earlier one
 */
function nextPost(
  unfinished: RecordMessagePost | null,
  {
    transcription,
    ...attempt
  }: Pick<RecordMessagePost, 'body' | 'expectedRecordRevision'> & {
    transcription: TranscriptionDetail | null;
  },
): RecordMessagePost {
  const wanted = {
    ...attempt,
    transcriptionIds: transcription ? [transcription.transcriptionId] : [],
  };
  const repeated =
    unfinished?.body === wanted.body &&
    unfinished.transcriptionIds.join() === wanted.transcriptionIds.join();

  return repeated
    ? unfinished
    : recordMessagePostSchema.parse({ ...wanted, requestKey: randomUUID() });
}

/**
 * writes, speaks, and sends messages about one record
 * @param options API transport, the shown record, and translations
 * @param options.api authenticated API transport
 * @param options.recordId record the messages are about
 * @param options.record the record as the screen currently shows it
 * @param options.t translation function for message keys
 * @returns composer text, sending state, and the send action
 */
export function useMessageComposer({
  api,
  recordId,
  record,
  t,
}: MessageComposerOptions): MessageComposer {
  const queryClient = useQueryClient();
  const [text, setCurrentText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // an unanswered post, kept so a retry repeats it under the same key
  const [unfinished, setUnfinished] = useState<RecordMessagePost | null>(null);
  const voice = useVoiceMessage({
    api,
    recordId,
    onTranscript: setCurrentText,
    onError: (cause) => setError(describeMessageError(cause, t)),
    onPermissionDenied: () => setError(t('permissionDenied')),
  });
  const body = text.trim();
  const canSend =
    body !== '' &&
    !busy &&
    !['recording', 'transcribing'].includes(voice.phase);
  const refresh = async (queryKey: readonly unknown[]): Promise<void> =>
    queryClient.invalidateQueries({ queryKey });

  const send = async (shown: RecordDetail): Promise<void> => {
    setBusy(true);
    setError('');
    const post = nextPost(unfinished, {
      body,
      transcription: voice.transcription,
      expectedRecordRevision: shown.recordRevision,
    });
    try {
      await postRecordMessage(api, recordId, post);
      setUnfinished(null);
      setCurrentText('');
      voice.reset();
      await refresh(recordMessagesKey(recordId));
    } catch (cause) {
      setError(describeMessageError(cause, t));
      // a stale post can never succeed: forget its key and reload the record
      const stale = isRevisionConflict(cause);
      setUnfinished(stale ? null : post);
      if (stale) {
        await refresh(recordQuery(api, recordId).queryKey);
      }
    } finally {
      setBusy(false);
    }
  };

  return {
    text,
    setText: (next) =>
      setCurrentText(next.slice(0, recordMessageBodyMaxLength)),
    busy,
    error,
    send: record && canSend ? async () => send(record) : undefined,
    voice,
  };
}
