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

import type { ApiTransport } from '@antica/client';
import type {
  RecordDetail,
  RecordMessageEntry,
  RecordMessagePost,
} from '@antica/contracts';

import type { MessageKey } from '../../../../i18n/messages';

/** where sending a failed message again stands */
export interface ResendState {
  status: 'sending' | 'failed' | 'accepted';
  /** the resend's own post, kept so a network retry repeats it under the same key */
  post: RecordMessagePost | null;
  error: string;
}

/** sending failed messages again, independently of the composer */
export interface Resend {
  stateOf: (messageId: string) => ResendState | undefined;
  /** posts a failed message again; absent while the record is not shown */
  resend?: (entry: RecordMessageEntry) => Promise<void>;
}

/** what resending needs from the screen around it */
export interface ResendOptions {
  api: ApiTransport;
  recordId: string;
  /** the record as the screen currently shows it */
  record: RecordDetail | undefined;
  t: (key: MessageKey) => string;
}

/**
 * posts failed messages again, each under its own request key, without touching the composer
 * @param options API transport, the shown record, and translations
 * @param options.api authenticated API transport
 * @param options.recordId record the messages are about
 * @param options.record the record as the screen currently shows it
 * @param options.t translation function for message keys
 * @returns each message's resend state and the resend action
 */
export function useResend({ api, recordId, record, t }: ResendOptions): Resend {
  const queryClient = useQueryClient();
  const [states, setStates] = useState<
    Readonly<Partial<Record<string, ResendState>>>
  >({});

  const store = (messageId: string, state: ResendState): void => {
    setStates((current) => ({ ...current, [messageId]: state }));
  };

  const resend = async (
    shown: RecordDetail,
    entry: RecordMessageEntry,
  ): Promise<void> => {
    const post =
      states[entry.id]?.post ??
      recordMessagePostSchema.parse({
        requestKey: randomUUID(),
        body: entry.body.slice(0, recordMessageBodyMaxLength),
        transcriptionIds: [],
        expectedRecordRevision: shown.recordRevision,
      });
    store(entry.id, { status: 'sending', post, error: '' });
    try {
      await postRecordMessage(api, recordId, post);
      store(entry.id, { status: 'accepted', post, error: '' });
      await queryClient.invalidateQueries({
        queryKey: recordMessagesKey(recordId),
      });
    } catch (cause) {
      const stale = isRevisionConflict(cause);
      store(entry.id, {
        status: 'failed',
        post: stale ? null : post,
        error: describeMessageError(cause, t),
      });
      if (stale) {
        await queryClient.invalidateQueries({
          queryKey: recordQuery(api, recordId).queryKey,
        });
      }
    }
  };

  return {
    stateOf: (messageId) => states[messageId],
    resend: record ? async (entry) => resend(record, entry) : undefined,
  };
}
