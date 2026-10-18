import { ActivityIndicator, Text, TextInput, View } from 'react-native';

import { ActionButton, colors, styles } from '@antica/ui';

import { BusyButton } from '../../../components/BusyButton';
import { useLocale } from '../../../providers/LocaleProvider';

import type { FC } from 'react';

/** where the latest code request stands */
export type CodeDelivery = 'sending' | 'sent' | 'failed' | 'rateLimited';

/** properties for the sign-in code step (A02–A05) */
export type LoginCodeStepProps = {
  /** number the code was requested for, already masked */
  maskedPhone: string;
  delivery: CodeDelivery;
  /** whether verification reported the code as expired */
  expired: boolean;
  code: string;
  onChangeCode: (code: string) => void;
  /** whether a verification request is running */
  verifying: boolean;
  onVerify: () => void;
  /** seconds before another code may be requested */
  resendSeconds: number;
  onResend: () => void;
  onChangeNumber: () => void;
  /** localized failure of the last verification */
  error: string;
};

const deliveryKeys = {
  sending: 'deliverySending',
  sent: 'deliverySent',
  failed: 'deliveryFailed',
  rateLimited: 'deliveryRateLimited',
} as const;

const deliveryTestIds = {
  sending: 'login-delivery-sending',
  sent: 'login-delivery-sent',
  failed: 'login-delivery-failed',
  rateLimited: 'login-delivery-rate-limited',
} as const;

/** digits in a sign-in code */
const codeLength = 6;

/**
 * names the masked number and announces where the code request stands
 * @param props delivery properties
 * @param props.maskedPhone masked number the code was requested for
 * @param props.delivery where the latest code request stands
 * @returns the number heading and delivery row
 */
const DeliveryStatus: FC<
  Pick<LoginCodeStepProps, 'maskedPhone' | 'delivery'>
> = ({ maskedPhone, delivery }) => {
  const { t } = useLocale();
  const failed = delivery === 'failed' || delivery === 'rateLimited';

  return (
    <>
      <Text testID="login-masked-phone" style={styles.heading}>
        {t('codePhone', { phone: maskedPhone })}
      </Text>
      <View
        testID={deliveryTestIds[delivery]}
        accessible
        accessibilityLiveRegion="polite"
        accessibilityRole={failed ? 'alert' : 'text'}
        style={styles.row}>
        {delivery === 'sending' && <ActivityIndicator color={colors.jade} />}
        <Text style={failed ? styles.error : styles.body}>
          {t(deliveryKeys[delivery])}
        </Text>
      </View>
    </>
  );
};

/**
 * takes the six-digit code, locked while it is being verified
 * @param props field properties
 * @param props.code current code entry
 * @param props.onChangeCode receives edited code text
 * @param props.verifying whether verification is running
 * @param props.onSubmit submits from the keyboard; absent while the code cannot be verified
 * @returns the labelled code field
 */
const CodeField: FC<
  Pick<LoginCodeStepProps, 'code' | 'onChangeCode' | 'verifying'> & {
    onSubmit: (() => void) | undefined;
  }
> = ({ code, onChangeCode, verifying, onSubmit }) => {
  const { t } = useLocale();

  return (
    <View testID="login-code" style={{ gap: 6 }}>
      <Text style={styles.label}>{t('code')}</Text>
      <TextInput
        testID="login-code-input"
        accessibilityLabel={t('code')}
        accessibilityState={{ disabled: verifying }}
        autoComplete="one-time-code"
        keyboardType="number-pad"
        editable={!verifying}
        maxLength={codeLength}
        onChangeText={(value) =>
          onChangeCode(value.replace(/\D/g, '').slice(0, codeLength))
        }
        onSubmitEditing={onSubmit}
        returnKeyType="done"
        style={styles.field}
        value={code}
      />
    </View>
  );
};

/**
 * shows the masked number, code delivery, the code field, and a verify action that cannot submit twice
 * @param props step properties
 * @param props.maskedPhone masked number the code was requested for
 * @param props.delivery where the latest code request stands
 * @param props.expired whether the code expired
 * @param props.code current code entry
 * @param props.onChangeCode receives edited code text
 * @param props.verifying whether verification is running
 * @param props.onVerify submits the code
 * @param props.resendSeconds seconds before another code may be requested
 * @param props.onResend requests another code
 * @param props.onChangeNumber returns to number entry
 * @param props.error localized verification failure
 * @returns the code step content
 */
export const LoginCodeStep: FC<LoginCodeStepProps> = ({
  maskedPhone,
  delivery,
  expired,
  code,
  onChangeCode,
  verifying,
  onVerify,
  resendSeconds,
  onResend,
  onChangeNumber,
  error,
}) => {
  const { t } = useLocale();
  const canVerify =
    code.length === codeLength && !expired && delivery !== 'sending';

  return (
    <>
      <DeliveryStatus maskedPhone={maskedPhone} delivery={delivery} />
      {expired && (
        <Text
          testID="login-expired"
          accessibilityRole="alert"
          style={styles.error}>
          {t('expired')}
        </Text>
      )}
      <CodeField
        code={code}
        onChangeCode={onChangeCode}
        verifying={verifying}
        onSubmit={canVerify ? onVerify : undefined}
      />
      <BusyButton
        testID="login-verify"
        label={verifying ? t('verifying') : t('verify')}
        onPress={onVerify}
        busy={verifying}
        disabled={!canVerify}
      />
      {verifying && (
        <Text
          testID="login-verifying"
          accessibilityLiveRegion="polite"
          style={[styles.secondary, { textAlign: 'center' }]}>
          {t('verifyingWait')}
        </Text>
      )}
      {Boolean(error) && (
        <Text
          testID="login-verify-error"
          accessibilityRole="alert"
          style={styles.error}>
          {error}
        </Text>
      )}
      <ActionButton
        testID="login-resend"
        label={
          resendSeconds
            ? t('resendCountdown', { seconds: resendSeconds })
            : delivery === 'failed'
              ? t('retry')
              : t('resend')
        }
        onPress={onResend}
        disabled={verifying || delivery === 'sending' || resendSeconds > 0}
        secondary
      />
      <ActionButton
        testID="login-change-number"
        label={t('changeNumber')}
        onPress={onChangeNumber}
        disabled={verifying}
        secondary
      />
    </>
  );
};
