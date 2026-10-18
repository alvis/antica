import { Image, Text, View } from 'react-native';

import { ActionButton, TextField, styles } from '@antica/ui';

import { useLocale } from '../../../i18n/LocaleProvider';

import type { FC } from 'react';

import type { LocalMedia } from '../../../adapters/media-upload';

export type CaptureComponentsStepProps = {
  kind: 'single' | 'set';
  files: LocalMedia[];
  onLabel: (fileId: string, componentLabel: string) => void;
  onPhoto: () => void;
  onContinue: () => void;
};

export const CaptureComponentsStep: FC<CaptureComponentsStepProps> = ({
  kind,
  files,
  onLabel,
  onPhoto,
  onContinue,
}) => {
  const { t } = useLocale();

  return (
    <View style={styles.card}>
      <Text style={styles.heading}>{t('component')}</Text>
      {files
        .filter((file) => file.purpose === 'object')
        .map((file) => (
          <View key={file.id} style={styles.card}>
            {file.kind === 'photo' && (
              <Image
                source={{ uri: file.uri }}
                style={{ height: 160, width: '100%' }}
                resizeMode="contain"
                accessibilityLabel={file.name}
              />
            )}
            <Text style={styles.secondary}>{file.name}</Text>
            {kind === 'set' && (
              <TextField
                label={t('component')}
                value={file.componentLabel}
                onChangeText={(value) => onLabel(file.id, value)}
              />
            )}
          </View>
        ))}
      <ActionButton label={t('photo')} onPress={onPhoto} secondary />
      <ActionButton
        testID="capture-components-continue"
        label={t('continue')}
        onPress={onContinue}
      />
    </View>
  );
};
