import { Redirect } from 'expo-router';

import { useEffect, useState } from 'react';

import { Text, View } from 'react-native';

import { ActionButton, TextField, styles } from '@antica/ui';

import { authClient, useAuth } from '../auth';
import { Screen } from '../components/Screen';
import { useLocale } from '../locale';

type Stage = 'welcome' | 'phone' | 'code' | 'expired';

export default function LoginRoute() {
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
    <Screen title="antica" subtitle={t('privateCollection')}>
      <View style={styles.card}>
        {stage === 'welcome' && (
          <>
            <Text style={styles.heading}>{t('welcome')}</Text>
            <ActionButton
              label={t('whatsappLogin')}
              onPress={() => setStage('phone')}
            />
          </>
        )}
        {stage === 'phone' && (
          <>
            <TextField
              label={t('authorizedPhone')}
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
              autoComplete="tel"
            />
            <ActionButton
              label={t('continue')}
              onPress={() => void send()}
              disabled={busy || !phone.trim()}
            />
          </>
        )}
        {(stage === 'code' || stage === 'expired') && (
          <>
            <Text style={styles.body}>
              {t('sentTo')} {phone.trim().replace(/.(?=.{4})/g, '•')}
            </Text>
            {stage === 'expired' && (
              <Text accessibilityRole="alert" style={styles.error}>
                {t('expired')}
              </Text>
            )}
            <TextField
              label={t('code')}
              value={code}
              onChangeText={(value) =>
                setCode(value.replace(/\D/g, '').slice(0, 6))
              }
              keyboardType="number-pad"
              autoComplete="one-time-code"
            />
            <ActionButton
              label={busy ? t('verifying') : t('verify')}
              onPress={() => void verify()}
              disabled={busy || code.length !== 6 || stage === 'expired'}
            />
            <ActionButton
              label={seconds ? `${t('resend')} (${seconds}s)` : t('resend')}
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
}
