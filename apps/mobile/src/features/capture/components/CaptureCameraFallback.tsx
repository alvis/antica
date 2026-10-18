import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ActionButton, colors, styles } from '@antica/ui';

import { useLocale } from '../../../providers/LocaleProvider';

import type { FC } from 'react';

export type CaptureCameraFallbackProps = {
  /** camera access was refused, or the camera failed to start */
  reason: 'denied' | 'unavailable';
  onOpenSettings: () => void;
  onImport: () => void;
  onClose: () => void;
};

const layout = StyleSheet.create({
  frame: { flex: 1, backgroundColor: colors.canvas },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.jade,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  close: {
    minWidth: 48,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: { color: colors.card, fontSize: 18, fontWeight: '700' },
  title: { color: colors.card, fontSize: 20, fontWeight: '700' },
  body: { padding: 16, gap: 16 },
});

/**
 * offers library import when the in-app camera cannot be used, with a route to system settings
 * when access was denied
 * @param props fallback reason and handlers
 * @param props.reason denied access or an unavailable camera
 * @param props.onOpenSettings opens the app's system settings
 * @param props.onImport imports photos from the library instead
 * @param props.onClose leaves the camera
 * @returns the fallback screen
 */
export const CaptureCameraFallback: FC<CaptureCameraFallbackProps> = ({
  reason,
  onOpenSettings,
  onImport,
  onClose,
}) => {
  const { t } = useLocale();

  return (
    <View testID={`capture-camera-${reason}`} style={layout.frame}>
      <View style={layout.header}>
        <Pressable
          testID="capture-camera-close"
          accessibilityRole="button"
          accessibilityLabel={t('cameraClose')}
          onPress={onClose}
          style={layout.close}>
          <Text style={layout.headerText}>✕</Text>
        </Pressable>
        <Text accessibilityRole="header" style={layout.title}>
          {t('cameraTitle')}
        </Text>
      </View>
      <View style={layout.body}>
        <Text accessibilityRole="alert" style={styles.body}>
          {t(reason === 'denied' ? 'cameraDenied' : 'cameraUnavailable')}
        </Text>
        <ActionButton
          testID="capture-camera-import"
          label={t('import')}
          onPress={onImport}
        />
        {reason === 'denied' && (
          <ActionButton
            testID="capture-camera-settings"
            label={t('openSettings')}
            onPress={onOpenSettings}
            secondary
          />
        )}
      </View>
    </View>
  );
};
