import { useCallback, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

import { useInterfaceLanguage } from '../../../providers/LocaleProvider';

import type {
  InterfaceLanguagePreference,
  LanguageSettingsState,
  LocalPreferences,
} from '../../../i18n/preferences';
import type {
  InterfaceLanguagePreview,
  PreferencesStatus,
} from '../../../providers/LocaleProvider';

/** language-screen state once the saved preferences have been read */
export type LoadedLanguageSettingsState = Exclude<
  LanguageSettingsState,
  { kind: 'loading' }
>;

/** draft, preview and commands of the interface-language screen */
export interface LanguageSettings {
  /** saved choice, unsaved draft and save progress */
  state: LoadedLanguageSettingsState;
  /** how the draft renders on this device */
  draftPreview: InterfaceLanguagePreview;
  /** what Follow system currently resolves to on this device */
  systemPreview: InterfaceLanguagePreview;
  /** whether the last save succeeded and the draft has not changed since */
  updated: boolean;
  /**
   * changes the draft and its preview without saving
   * @param choice choice to preview
   */
  select: (choice: InterfaceLanguagePreference) => void;
  /**
   * saves the draft; repeated calls while a save is running are ignored
   * @returns completion of the save attempt
   */
  save: () => Promise<void>;
  /**
   * reads the saved choice again after a failed read
   * @returns completion of the read
   */
  retryRead: () => Promise<void>;
}

/** progress of the current save, apart from the provider's read status */
type SavePhase = 'idle' | 'saving' | 'failed' | 'updated';

/**
 * combines save progress with the provider's read status into the screen state
 * @param inputs save progress, read status, saved preferences and draft
 * @param inputs.phase progress of the current save
 * @param inputs.status whether the saved preferences could be read
 * @param inputs.saved saved preferences
 * @param inputs.draft unsaved choice
 * @returns the screen state; a failed save outranks a failed read
 */
function screenState({
  phase,
  status,
  saved,
  draft,
}: {
  phase: SavePhase;
  status: PreferencesStatus;
  saved: LocalPreferences;
  draft: InterfaceLanguagePreference;
}): LoadedLanguageSettingsState {
  if (phase === 'saving') {
    return { kind: 'saving', saved, draft };
  }
  if (phase === 'failed' || status === 'read_failed') {
    return {
      kind: 'error',
      saved,
      draft,
      reason: phase === 'failed' ? 'write_failed' : 'read_failed',
    };
  }

  return { kind: 'ready', saved, draft };
}

/**
 * keeps an unsaved language choice with its preview, and saves it on request
 * @returns the screen state and its commands
 */
export function useLanguageSettings(): LanguageSettings {
  const {
    preview,
    retryRead,
    save: saveChoice,
    saved,
    status,
  } = useInterfaceLanguage();
  // until the collector picks a choice, the draft follows the saved one, including a choice that
  // arrives after the screen mounted: a slow first read, a late read, or a successful retry
  const [picked, setPicked] = useState<InterfaceLanguagePreference | null>(
    null,
  );
  const draft = picked ?? saved.interfaceLanguage;
  const [phase, setPhase] = useState<SavePhase>('idle');
  // blocks a second save before the first one has re-rendered the disabled button
  const saving = useRef(false);

  const select = useCallback((choice: InterfaceLanguagePreference): void => {
    setPicked(choice);
    setPhase((current) => (current === 'updated' ? 'idle' : current));
  }, []);

  const save = useCallback(async (): Promise<void> => {
    if (saving.current) {
      return;
    }
    saving.current = true;
    setPhase('saving');
    try {
      await saveChoice(draft);
      setPhase('updated');
      AccessibilityInfo.announceForAccessibility(
        preview(draft).t('languageUpdated'),
      );
    } catch {
      // the previous choice stays saved and active; the draft is kept for Retry
      setPhase('failed');
    } finally {
      saving.current = false;
    }
  }, [draft, preview, saveChoice]);

  const state = useMemo(
    () => screenState({ phase, status, saved, draft }),
    [draft, phase, saved, status],
  );

  const draftPreview = useMemo(() => preview(draft), [draft, preview]);
  const systemPreview = useMemo(() => preview('system'), [preview]);

  return useMemo(
    () => ({
      state,
      draftPreview,
      systemPreview,
      updated: phase === 'updated',
      select,
      save,
      retryRead,
    }),
    [draftPreview, phase, retryRead, save, select, state, systemPreview],
  );
}
