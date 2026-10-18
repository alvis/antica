import { Redirect, useRouter } from 'expo-router';

import { useEffect, useState } from 'react';

import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ActionButton, TextField, colors, styles } from '@antica/ui';

import { Screen } from '../../../components/Screen';
import { authClient, useAuth } from '../../../providers/AuthProvider';
import { useLocale } from '../../../providers/LocaleProvider';

import type { FC } from 'react';

type Stage = 'welcome' | 'phone' | 'code' | 'expired';

const layout = StyleSheet.create({
  language: { minHeight: 48, justifyContent: 'center', paddingHorizontal: 4 },
  languageText: { color: colors.jade, fontSize: 16, fontWeight: '700' },
});

export const LoginContainer: FC = () => {
  const router = useRouter();
  const { authenticated, refresh } = useAuth();
  const { t } = useLocale();
  const [stage, setStage] = useState<Stage>('welcome');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [seconds, setSeconds] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (seconds <= 0) {
      return;
    }
    const interval = setInterval(
      () => setSeconds((value) => Math.max(0, value - 1)),
      1000,
    );

    return () => clearInterval(interval);
  }, [seconds]);

  if (authenticated) {
    return <Redirect href="/collection" />;
  }

  const send = async (): Promise<void> => {
    if (busy) {
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result = await authClient.phoneNumber.sendOtp({
        phoneNumber: phone.trim(),
      });
      if (result.error) {
        throw new Error(result.error.message);
      }
      setCode('');
      setSeconds(60);
      setStage('code');
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const verify = async (): Promise<void> => {
    if (busy || code.length !== 6) {
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result = await authClient.phoneNumber.verify({
        phoneNumber: phone.trim(),
        code,
      });
      if (result.error) {
        if (result.error.code === 'OTP_EXPIRED') {
          setStage('expired');
        }
        throw new Error(result.error.message);
      }
      await refresh();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      title="antica"
      subtitle={t('privateCollection')}
      action={
        // opens only the language selector, never Settings or account content
        <Pressable
          testID="login-language"
          accessibilityRole="button"
          accessibilityLabel={t('languageScreenTitle')}
          onPress={() => router.push('/settings/language')}
          style={layout.language}>
          <Text style={layout.languageText}>
            {'\u{1F310}'} {t('languageScreenTitle')}
          </Text>
        </Pressable>
      }>
      <View style={styles.card}>
        {stage === 'welcome' && (
          <>
            <Text style={styles.heading}>{t('welcome')}</Text>
            <ActionButton
              testID="login-start"
              label={t('whatsappLogin')}
              onPress={() => setStage('phone')}
            />
          </>
        )}
        {stage === 'phone' && (
          <>
            {/* the shared field takes no testID, so automation targets its wrapper */}
            <View testID="login-phone">
              <TextField
                label={t('authorizedPhone')}
                value={phone}
                onChangeText={setPhone}
                keyboardType="phone-pad"
                autoComplete="tel"
              />
            </View>
            <ActionButton
              testID="login-send-code"
              label={t('continue')}
              onPress={() => void send()}
              disabled={busy || !phone.trim()}
            />
          </>
        )}
        {(stage === 'code' || stage === 'expired') && (
          <>
            <Text style={styles.body}>
              {t('sentToPhone', {
                phone: phone.trim().replace(/.(?=.{4})/g, '•'),
              })}
            </Text>
            {stage === 'expired' && (
              <Text accessibilityRole="alert" style={styles.error}>
                {t('expired')}
              </Text>
            )}
            <View testID="login-code">
              <TextField
                label={t('code')}
                value={code}
                onChangeText={(value) =>
                  setCode(value.replace(/\D/g, '').slice(0, 6))
                }
                keyboardType="number-pad"
                autoComplete="one-time-code"
              />
            </View>
            <ActionButton
              testID="login-verify"
              label={busy ? t('verifying') : t('verify')}
              onPress={() => void verify()}
              disabled={busy || code.length !== 6 || stage === 'expired'}
            />
            <ActionButton
              label={seconds ? t('resendCountdown', { seconds }) : t('resend')}
              onPress={() => void send()}
              disabled={busy || seconds > 0}
              secondary
            />
          </>
        )}
        {Boolean(error) && (
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
        )}
      </View>
    </Screen>
  );
};
