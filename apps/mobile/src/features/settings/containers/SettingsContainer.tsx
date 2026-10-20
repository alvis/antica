import { useRouter } from 'expo-router';

import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ActionButton, colors, styles } from '@antica/ui';

import { Screen } from '../../../components/Screen';
import { localeAutonyms } from '../../../i18n/preferences';
import { useAuth } from '../../../providers/AuthProvider';
import {
  useInterfaceLanguage,
  useLocale,
} from '../../../providers/LocaleProvider';

import type { FC } from 'react';

import type {
  InterfaceLanguageState,
  LocaleState,
} from '../../../providers/LocaleProvider';

const layout = StyleSheet.create({
  languageRow: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  chevron: { color: colors.muted, fontSize: 24 },
});

/**
 * names the saved interface language, or Follow system with the language it resolved to
 * @param language the saved and resolved interface language
 * @param language.saved the saved preference
 * @param language.resolved the locale in effect
 * @param t translator for the Follow system label
 * @returns the label shown on the language row
 */
function describeLanguageChoice(
  { saved, resolved }: Pick<InterfaceLanguageState, 'saved' | 'resolved'>,
  t: LocaleState['t'],
): string {
  return saved.interfaceLanguage === 'system'
    ? `${t('followSystem')} · ${localeAutonyms[resolved.locale]}`
    : localeAutonyms[saved.interfaceLanguage];
}

/**
 * the row that opens research notes, which v5 keeps under 我 instead of a tab
 * @returns a card with one chevron row
 */
const ResearchLink: FC = () => {
  const router = useRouter();
  const { t } = useLocale();

  return (
    <View style={styles.card}>
      <Pressable
        testID="settings-research"
        accessibilityRole="button"
        accessibilityLabel={t('researchRecords')}
        onPress={() => router.push('/research')}
        style={layout.languageRow}>
        <Text style={styles.heading}>{t('researchRecords')}</Text>
        <Text style={layout.chevron}>›</Text>
      </Pressable>
    </View>
  );
};

/**
 * shows the device's interface language, research notes and the account action; it is the 我 tab
 * and is also reachable after sign-in from the gear in the other main tabs
 * @returns the Settings home
 */
export const SettingsContainer: FC = () => {
  const router = useRouter();
  const { phone, signOut } = useAuth();
  const { t } = useLocale();
  const language = useInterfaceLanguage();
  const { status, retryRead } = language;
  const choice = describeLanguageChoice(language, t);

  // the language preference lives on the device and survives sign-out; the session provider
  // clears private data, and signs out locally even when the server cannot be reached
  const leave = async (): Promise<void> => {
    try {
      await signOut();
    } catch (error) {
      console.warn('The server session could not be ended.', error);
    }
    router.replace('/login');
  };

  return (
    <Screen title={t('tabMe')}>
      <View style={styles.card}>
        <Pressable
          testID="settings-language"
          accessibilityRole="button"
          accessibilityLabel={`${t('language')}, ${choice}`}
          onPress={() => router.push('/settings/language')}
          style={layout.languageRow}>
          <Text style={styles.heading}>
            {t('language')} · {choice}
          </Text>
          <Text style={layout.chevron}>›</Text>
        </Pressable>
        <Text style={styles.secondary}>{t('languageScopeHint')}</Text>
        {status === 'read_failed' && (
          <>
            <Text accessibilityRole="alert" style={styles.error}>
              {t('languageReadFailed')}
            </Text>
            <ActionButton
              label={t('retry')}
              onPress={() => void retryRead()}
              secondary
            />
          </>
        )}
      </View>
      <ResearchLink />
      <View style={styles.card}>
        <Text style={styles.heading}>{t('session')}</Text>
        <Text style={styles.body}>
          {phone?.replace(/.(?=.{4})/g, '•') ?? t('unknown')}
        </Text>
        <ActionButton
          testID="settings-sign-out"
          label={t('signOut')}
          onPress={() => void leave()}
          secondary
        />
      </View>
    </Screen>
  );
};
