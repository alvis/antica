import { useState } from 'react';

import { recordMessageBodyMaxLength } from '@antica/contracts';

import type { Dispatch, SetStateAction } from 'react';

import type { RecordMessagePost } from '@antica/contracts';

import type { MessageKey } from '../../../../i18n/messages';

/** Draft words, transient send state and idempotency identity. */
interface ComposerDraft {
  text: string;
  busy: boolean;
  error: string;
  hint: string;
  unfinished: RecordMessagePost | null;
  setText: (text: string) => void;
  setBusy: Dispatch<SetStateAction<boolean>>;
  setError: Dispatch<SetStateAction<string>>;
  setUnfinished: Dispatch<SetStateAction<RecordMessagePost | null>>;
  reset: () => void;
  restore: (body: string) => void;
}

/**
 * Retains network retries while treating restored history as a fresh collector draft.
 * @param t translations for the source reattachment hint
 * @param initialText unsent words to start from, such as a question picked in the ask sheet
 * @returns draft state and explicit lifecycle actions
 */
export function useComposerDraft(
  t: (key: MessageKey) => string,
  initialText = '',
): ComposerDraft {
  const [text, setText] = useState(() =>
    initialText.slice(0, recordMessageBodyMaxLength),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [restored, setRestored] = useState(false);
  const [unfinished, setUnfinished] = useState<RecordMessagePost | null>(null);

  return {
    text,
    busy,
    error,
    unfinished,
    hint: restored ? t('knowledgeReattachSources') : '',
    setText: (next) => setText(next.slice(0, recordMessageBodyMaxLength)),
    setBusy,
    setError,
    setUnfinished,
    reset: () => {
      setUnfinished(null);
      setRestored(false);
      setText('');
    },
    restore: (body) => {
      setText(body.slice(0, recordMessageBodyMaxLength));
      setUnfinished(null);
      setRestored(true);
      setError('');
    },
  };
}
