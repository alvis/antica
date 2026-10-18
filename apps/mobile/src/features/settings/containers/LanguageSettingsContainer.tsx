import { useRouter } from 'expo-router';

import { useEffect } from 'react';
import { BackHandler, Text, View } from 'react-native';

import { ActionButton, styles } from '@antica/ui';

import { Screen } from '../../../components/Screen';
import {
  interfaceLanguagePreferences,
  localeAutonyms,
} from '../../../i18n/preferences';
import { useLocale } from '../../../providers/LocaleProvider';

import { LanguageOption } from '../components/LanguageOption';
import { useLanguageSettings } from '../hooks/useLanguageSettings';

import type { FC } from 'react';

import type {
  InterfaceLanguagePreference,
  ResolvedInterfaceLanguage,
} from '../../../i18n/preferences';
import type { InterfaceLanguagePreview } from '../../../providers/LocaleProvider';

/**
 * consumes hardware Back while held, so it waits for a running save like the Cancel button
 * @param held whether Back must wait
 */
function useHoldHardwareBack(held: boolean): void {
  useEffect(() => {
    if (!held) {
      return undefined;
    }
    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      () => true,
    );

    return () => subscription.remove();
  }, [held]);
}

/** properties of the language choices */
interface LanguageChoicesProps {
  /** selected draft choice */
  draft: InterfaceLanguagePreference;
  /** locks the choices while a save runs */
  saving: boolean;
  /** what Follow system resolves to on this device */
  system: ResolvedInterfaceLanguage;
  /** changes the draft */
  onSelect: (choice: InterfaceLanguagePreference) => void;
}

/**
 * lists the choices, each language in its own script, as one radio group
 * @param props choice properties
 * @param props.draft selected draft choice
 * @param props.saving locks the choices while a save runs
 * @param props.system what Follow system resolves to on this device
 * @param props.onSelect changes the draft
 * @returns the radio group
 */
const LanguageChoices: FC<LanguageChoicesProps> = ({
  draft,
  saving,
  system,
  onSelect,
}) => {
  const { t } = useLocale();
  const systemLanguage = localeAutonyms[system.locale];
  const details: Partial<Record<InterfaceLanguagePreference, string>> = {
    'zh-Hant': t('defaultLanguage'),
    'system': system.usedSystemFallback
      ? t('systemLanguageFallback', { language: systemLanguage })
      : systemLanguage,
  };

  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={t('language')}
      style={styles.card}>
      {interfaceLanguagePreferences.map((choice) => (
        <LanguageOption
          key={choice}
          testID={`language-option-${choice}`}
          label={
            choice === 'system' ? t('followSystem') : localeAutonyms[choice]
          }
          detail={details[choice]}
          checked={draft === choice}
          disabled={saving}
          onPress={() => onSelect(choice)}
        />
      ))}
    </View>
  );
};

/**
 * shows sample interface copy in the draft language without switching the interface
 * @param props preview properties
 * @param props.preview the draft language and its translation function
 * @returns the preview card
 */
const LanguagePreview: FC<{ preview: InterfaceLanguagePreview }> = ({
  preview,
}) => {
  const { t } = useLocale();

  return (
    <View testID="language-preview" style={styles.card}>
      <Text style={styles.label}>{t('languagePreview')}</Text>
      <Text style={styles.heading}>
        {preview.t('settings')} · {preview.t('language')}
      </Text>
      <Text style={styles.body}>
        {preview.t('save')} / {preview.t('cancel')}
      </Text>
    </View>
  );
};

/** properties of the Save and Cancel row */
interface LanguageActionsProps {
  /** a save is running */
  saving: boolean;
  /** the last save failed, so Save retries it */
  writeFailed: boolean;
  /** the last save succeeded and the draft has not changed since */
  updated: boolean;
  /** the draft equals the saved choice, so there is nothing to save */
  unchanged: boolean;
  /** saves the draft */
  onSave: () => void;
}

/**
 * offers Save, and Cancel that becomes Done once the choice is saved; both wait for a running save
 * @param props action properties
 * @param props.saving a save is running
 * @param props.writeFailed the last save failed, so Save retries it
 * @param props.updated the last save succeeded and the draft has not changed since
 * @param props.unchanged the draft equals the saved choice
 * @param props.onSave saves the draft
 * @returns the action row
 */
const LanguageActions: FC<LanguageActionsProps> = ({
  saving,
  writeFailed,
  updated,
  unchanged,
  onSave,
}) => {
  const router = useRouter();
  const { t } = useLocale();
  useHoldHardwareBack(saving);

  // leaving without Save keeps the saved choice; a direct link has no screen to return to
  const leave = (): void =>
    router.canGoBack() ? router.back() : router.replace('/');

  return (
    <View style={styles.row}>
      <ActionButton
        testID="language-save"
        label={writeFailed ? t('retry') : t('save')}
        onPress={onSave}
        disabled={saving || unchanged}
      />
      <ActionButton
        testID="language-cancel"
        label={updated ? t('done') : t('cancel')}
        onPress={leave}
        disabled={saving}
        secondary
      />
    </View>
  );
};

/**
 * lets the collector preview and save the interface language; it is reachable before sign-in,
 * so it reads only the device-local preference and never session, account or collection data
 * @returns the language selector
 */
export const LanguageSettingsContainer: FC = () => {
  const { t } = useLocale();
  const {
    state,
    draftPreview,
    systemPreview,
    updated,
    select,
    save,
    retryRead,
  } = useLanguageSettings();
  const saving = state.kind === 'saving';
  const writeFailed = state.kind === 'error' && state.reason === 'write_failed';
  const readFailed = state.kind === 'error' && state.reason === 'read_failed';

  return (
    <Screen title={t('languageScreenTitle')}>
      {readFailed && (
        <View style={styles.card}>
          <Text accessibilityRole="alert" style={styles.error}>
            {t('languageReadFailed')}
          </Text>
          <ActionButton
            testID="language-retry-read"
            label={t('retry')}
            onPress={() => void retryRead()}
            secondary
          />
        </View>
      )}
      <LanguageChoices
        draft={state.draft}
        saving={saving}
        system={systemPreview.resolved}
        onSelect={select}
      />
      <LanguagePreview preview={draftPreview} />
      {writeFailed && (
        <Text accessibilityRole="alert" style={styles.error}>
          {t('languageSaveFailed')}
        </Text>
      )}
      {updated && (
        // announced once by the save itself; this text only stays visible
        <Text testID="language-updated" style={styles.body}>
          {t('languageUpdated')}
        </Text>
      )}
      <LanguageActions
        saving={saving}
        writeFailed={writeFailed}
        updated={updated}
        unchanged={
          state.kind === 'ready' &&
          state.draft === state.saved.interfaceLanguage
        }
        onSave={() => void save()}
      />
    </Screen>
  );
};
