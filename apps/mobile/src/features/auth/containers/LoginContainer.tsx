import { Redirect, useRouter } from 'expo-router';

import { useEffect, useRef, useState } from 'react';

import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ActionButton, TextField, colors, styles, theme } from '@antica/ui';

import { BusyButton } from '../../../components/BusyButton';
import { Screen } from '../../../components/Screen';
import { authClient, useAuth } from '../../../providers/AuthProvider';
import { useLocale } from '../../../providers/LocaleProvider';

import { LoginCodeStep } from '../components/LoginCodeStep';
import { maskPhoneNumber } from '../phone-mask';

import type { FC } from 'react';

import type { MessageKey } from '../../../i18n/messages';

import type { CodeDelivery } from '../components/LoginCodeStep';

type Stage = 'welcome' | 'phone' | 'code' | 'expired' | 'session';

/** seconds the API waits before it sends another code to the same number */
const resendCooldownSeconds = 60;

/** failure reported by the Better Auth client for a phone request */
type AuthFailure = { code?: string; status?: number };

/**
 * tells whether an auth failure is a rate limit
 * @param failure failure reported by the auth client
 * @returns whether the API refused the request for being too frequent
 */
function isRateLimited(failure: AuthFailure): boolean {
  return failure.code === 'RATE_LIMITED' || failure.status === 429;
}

/**
 * localizes a verification failure; an expired code is shown as its own state
 * @param failure failure reported by the auth client
 * @returns the message key, or null when the code expired
 */
function verifyFailureKey(failure: AuthFailure): MessageKey | null {
  if (failure.code === 'OTP_EXPIRED' || failure.status === 410) {
    return null;
  }
  if (isRateLimited(failure)) {
    return 'verifyRateLimited';
  }

  return failure.code === 'OTP_INVALID' || failure.status === 401
    ? 'codeInvalid'
    : 'verifyFailed';
}

const layout = StyleSheet.create({
  language: { minHeight: 48, justifyContent: 'center', paddingHorizontal: 4 },
  languageText: {
    color: colors.jade,
    fontSize: 16,
    ...theme.font.face('sans', '700'),
  },
});

export const LoginContainer: FC = () => {
  const router = useRouter();
  const { authenticated, refresh } = useAuth();
  const { t } = useLocale();
  const [stage, setStage] = useState<Stage>('welcome');
  const [phone, setPhone] = useState('');
  // the number the current code was requested for; a later edit never changes where it is verified
  const [sentPhone, setSentPhone] = useState('');
  const [code, setCode] = useState('');
  const [seconds, setSeconds] = useState(0);
  const [delivery, setDelivery] = useState<CodeDelivery>('sending');
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState('');
  // refs close the gap before a re-render disables the controls, so repeated taps or Enter never resend
  const sendingRef = useRef(false);
  const verifyingRef = useRef(false);
  // each code request and each Change number starts a new attempt; a late reply to an older one is ignored
  const attemptRef = useRef(0);
  const [restoring, setRestoring] = useState(false);
  const restoringRef = useRef(false);

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
    if (sendingRef.current || verifyingRef.current) {
      return;
    }
    sendingRef.current = true;
    attemptRef.current += 1;
    const attempt = attemptRef.current;
    const target = phone.trim();
    setSentPhone(target);
    setDelivery('sending');
    setError('');
    setStage((current) => (current === 'phone' ? 'code' : current));
    try {
      const result = await authClient.phoneNumber.sendOtp({
        phoneNumber: target,
      });
      if (attempt !== attemptRef.current) {
        return;
      }
      if (result.error) {
        const limited = isRateLimited(result.error);
        setDelivery(limited ? 'rateLimited' : 'failed');
        if (limited) {
          setSeconds(resendCooldownSeconds);
        }

        return;
      }
      setCode('');
      setSeconds(resendCooldownSeconds);
      setStage('code');
      setDelivery('sent');
    } catch {
      if (attempt === attemptRef.current) {
        setDelivery('failed');
      }
    } finally {
      if (attempt === attemptRef.current) {
        sendingRef.current = false;
      }
    }
  };

  /** abandons the current number, so a reply still on its way cannot change the new one */
  const changeNumber = (): void => {
    attemptRef.current += 1;
    sendingRef.current = false;
    setError('');
    setCode('');
    setSeconds(0);
    setStage('phone');
  };

  /**
   * fetches the session for a code the API already accepted; the used code is never sent again
   */
  const restoreSession = async (): Promise<void> => {
    if (restoringRef.current) {
      return;
    }
    restoringRef.current = true;
    setRestoring(true);
    setError('');
    try {
      // an accepted code with no session to show is the same failure as an unreachable server
      if (!(await refresh())) {
        throw new Error('session missing after verification');
      }
    } catch {
      setStage('session');
      setError(t('sessionFailed'));
    } finally {
      restoringRef.current = false;
      setRestoring(false);
    }
  };

  /**
   * sends the code once, then fetches the session; the code stays locked until the session settles
   */
  const verify = async (): Promise<void> => {
    if (verifyingRef.current || code.length !== 6 || stage === 'expired') {
      return;
    }
    verifyingRef.current = true;
    setVerifying(true);
    setError('');
    try {
      const result = await authClient.phoneNumber.verify({
        phoneNumber: sentPhone,
        code,
      });
      if (!result.error) {
        await restoreSession();

        return;
      }
      const key = verifyFailureKey(result.error);
      if (key) {
        setError(t(key));
      } else {
        setStage('expired');
      }
    } catch {
      setError(t('verifyFailed'));
    } finally {
      verifyingRef.current = false;
      setVerifying(false);
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
              disabled={!phone.trim()}
            />
          </>
        )}
        {(stage === 'code' || stage === 'expired') && (
          <LoginCodeStep
            maskedPhone={maskPhoneNumber(sentPhone)}
            delivery={delivery}
            expired={stage === 'expired'}
            code={code}
            onChangeCode={setCode}
            verifying={verifying}
            onVerify={() => void verify()}
            resendSeconds={seconds}
            onResend={() => void send()}
            onChangeNumber={changeNumber}
            error={error}
          />
        )}
        {stage === 'session' && (
          <>
            <Text
              testID="login-session-error"
              accessibilityRole="alert"
              style={styles.error}>
              {error}
            </Text>
            <BusyButton
              testID="login-session-retry"
              label={t('retry')}
              onPress={() => void restoreSession()}
              busy={restoring}
            />
          </>
        )}
      </View>
    </Screen>
  );
};
