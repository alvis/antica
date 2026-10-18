import { Text, View } from 'react-native';

import { ActionButton, styles } from '@antica/ui';

import { useLocale } from '../../../i18n/LocaleProvider';

import type { FC } from 'react';

export type CaptureMediaStepProps = {
  onChoose: (camera: boolean, video: boolean) => void;
  onContinue: () => void;
};

export const CaptureMediaStep: FC<CaptureMediaStepProps> = ({
  onChoose,
  onContinue,
}) => {
  const { t } = useLocale();

  return (
    <View style={styles.card}>
      <Text style={styles.heading}>{t('capture')}</Text>
      <ActionButton label={t('photo')} onPress={() => onChoose(true, false)} />
      <ActionButton
        label={t('video')}
        onPress={() => onChoose(true, true)}
        secondary
      />
      <ActionButton
        label={t('import')}
        onPress={() => onChoose(false, false)}
        secondary
      />
      <ActionButton label={t('continue')} onPress={onContinue} secondary />
    </View>
  );
};
