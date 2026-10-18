import { Text, View } from 'react-native';

import { ActionButton, styles } from '@antica/ui';

import { useLocale } from '../../../i18n/LocaleProvider';

import type { FC } from 'react';

export type CaptureKindStepProps = {
  busy: boolean;
  onSelect: (kind: 'single' | 'set') => void;
};

export const CaptureKindStep: FC<CaptureKindStepProps> = ({
  busy,
  onSelect,
}) => {
  const { t } = useLocale();

  return (
    <View style={styles.card}>
      <Text style={styles.heading}>
        {t('single')} / {t('set')}
      </Text>
      <ActionButton
        testID="capture-kind-single"
        label={t('single')}
        onPress={() => onSelect('single')}
        disabled={busy}
      />
      <ActionButton
        testID="capture-kind-set"
        label={t('set')}
        onPress={() => onSelect('set')}
        disabled={busy}
        secondary
      />
    </View>
  );
};
