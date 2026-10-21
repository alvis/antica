import { useQueryClient } from '@tanstack/react-query';

import { randomUUID } from 'expo-crypto';

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
import { splitDiscussContext, withDiscussContext } from '../discuss-context';

import { useComposerDraft } from './useComposerDraft';

import { useKnowledgeAttachments } from './useKnowledgeAttachments';

import { useVoiceMessage } from './useVoiceMessage';

import type { ApiTransport } from '@antica/client';
import type {
  KnowledgeAttachment,
  RecordDetail,
  RecordMessagePost,
  TranscriptionDetail,
} from '@antica/contracts';

import type { MessageKey } from '../../../../i18n/messages';

import type { VoiceMessage } from './useVoiceMessage';

/** One visible collector-selected reference; the title is display-only. */
export interface ComposerKnowledgeAttachment {
  reference: KnowledgeAttachment;
  title: string;
}

/** the text being written, its sending state, and the voice flow that can fill it */
export interface MessageComposer {
  canRestore: boolean;
  restore: (body: string) => void;
  hint: string;
  attachments: ComposerKnowledgeAttachment[];
  attach: (reference: KnowledgeAttachment, title: string) => void;
  removeAttachment: (reference: KnowledgeAttachment) => void;
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
  /** unsent words the composer starts with; the collector still presses Send */
  initialText?: string;
  /** the suggestion under discussion, sent ahead of the next message so the assistant knows it */
  context?: string;
  /** called once a message carrying the context is sent */
  onContextSent?: () => void;
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
  }: Pick<
    RecordMessagePost,
    'body' | 'expectedRecordRevision' | 'knowledgeAttachments'
  > & {
    transcription: TranscriptionDetail | null;
  },
): RecordMessagePost {
  const wanted = {
    ...attempt,
    transcriptionIds: transcription ? [transcription.transcriptionId] : [],
  };
  const repeated =
    unfinished?.body === wanted.body &&
    unfinished.transcriptionIds.join() === wanted.transcriptionIds.join() &&
    JSON.stringify(unfinished.knowledgeAttachments ?? []) ===
      JSON.stringify(wanted.knowledgeAttachments ?? []);

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
export function useMessageComposer(
  options: MessageComposerOptions,
): MessageComposer {
  const { api, recordId, record, t, initialText, context, onContextSent } =
    options;
  const queryClient = useQueryClient();
  const draft = useComposerDraft(t, initialText);
  const knowledge = useKnowledgeAttachments(draft.busy);
  const voice = useVoiceMessage({
    api,
    recordId,
    onTranscript: draft.setText,
    onError: (cause) => draft.setError(describeMessageError(cause, t)),
    onPermissionDenied: () => draft.setError(t('permissionDenied')),
  });
  const ready = canSendMessage(draft.text, draft.busy, voice);
  const refresh = async (queryKey: readonly unknown[]): Promise<void> =>
    queryClient.invalidateQueries({ queryKey });

  const send = async (shown: RecordDetail): Promise<void> => {
    draft.setBusy(true);
    draft.setError('');
    let post: RecordMessagePost | undefined;
    try {
      const text = draft.text.trim();
      // A retry retains its first context and request key even if the label finishes loading later.
      const sentContext = draft.unfinished
        ? splitDiscussContext(draft.unfinished.body).context
        : undefined;
      const attached = sentContext ?? context;
      const body = attached ? withDiscussContext(attached, text) : text;
      if (body.length > recordMessageBodyMaxLength) {
        draft.setError(t('requestInvalid'));

        return;
      }
      post = nextPost(draft.unfinished, {
        body,
        transcription: voice.transcription,
        expectedRecordRevision: shown.recordRevision,
        knowledgeAttachments: knowledge.references,
      });
      await postRecordMessage(api, recordId, post);
      if (attached) {
        onContextSent?.();
      }
      draft.reset();
      knowledge.clear();
      voice.reset();
      await refresh(recordMessagesKey(recordId));
    } catch (cause) {
      draft.setError(describeMessageError(cause, t));
      // a stale post can never succeed: forget its key and reload the record
      const stale = isRevisionConflict(cause);
      draft.setUnfinished(stale ? null : (post ?? null));
      if (stale) {
        await refresh(recordQuery(api, recordId).queryKey);
      }
    } finally {
      draft.setBusy(false);
    }
  };

  return {
    canRestore:
      !draft.busy && !['recording', 'transcribing'].includes(voice.phase),
    restore: restoreMessage(draft, knowledge, voice),
    hint: draft.hint,
    attachments: knowledge.attachments,
    attach: knowledge.attach,
    removeAttachment: knowledge.remove,
    text: draft.text,
    setText: draft.setText,
    busy: draft.busy,
    error: draft.error,
    send: record && ready ? async () => send(record) : undefined,
    voice,
  };
}

/**
 * Allows a collector send when words are ready and voice input is settled.
 * @param text current draft words
 * @param busy posting state
 * @param voice current voice phase
 * @returns whether the explicit send action is available
 */
function canSendMessage(
  text: string,
  busy: boolean,
  voice: VoiceMessage,
): boolean {
  return (
    text.trim() !== '' &&
    !busy &&
    !['recording', 'transcribing'].includes(voice.phase)
  );
}

/**
 * Restores words for a new explicit send while discarding source and voice selection.
 * @param draft composer words and send state
 * @param knowledge currently selected attachments
 * @param voice pending recording or transcription
 * @returns collector action that never posts or infers historical attachments
 */
function restoreMessage(
  draft: ReturnType<typeof useComposerDraft>,
  knowledge: ReturnType<typeof useKnowledgeAttachments>,
  voice: VoiceMessage,
): (body: string) => void {
  return (body) => {
    if (draft.busy || ['recording', 'transcribing'].includes(voice.phase)) {
      return;
    }
    draft.restore(body);
    knowledge.clear();
    voice.reset();
  };
}
