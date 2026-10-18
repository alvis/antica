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
 * shows the device's interface language and the existing account action; it is reachable only
 * after sign-in, from the gear in each main tab
 * @returns the Settings home
 */
export const SettingsContainer: FC = () => {
  const router = useRouter();
  const { phone, signOut } = useAuth();
  const { t } = useLocale();
  const { saved, resolved, status, retryRead } = useInterfaceLanguage();
  const choice =
    saved.interfaceLanguage === 'system'
      ? `${t('followSystem')} · ${localeAutonyms[resolved.locale]}`
      : localeAutonyms[saved.interfaceLanguage];

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
    <Screen title={t('settings')}>
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
