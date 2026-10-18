import { Text, View } from 'react-native';

import { ActionButton, styles } from '@antica/ui';

import { useLocale } from '../../../providers/LocaleProvider';

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
      <ActionButton
        testID="capture-media-photo"
        label={t('photo')}
        onPress={() => onChoose(true, false)}
      />
      <ActionButton
        testID="capture-media-video"
        label={t('video')}
        onPress={() => onChoose(true, true)}
        secondary
      />
      <ActionButton
        testID="capture-media-import"
        label={t('import')}
        onPress={() => onChoose(false, false)}
        secondary
      />
      <ActionButton
        testID="capture-media-continue"
        label={t('continue')}
        onPress={onContinue}
        secondary
      />
    </View>
  );
};
