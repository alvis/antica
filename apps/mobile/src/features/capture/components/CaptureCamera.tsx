import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, styles, theme } from '@antica/ui';

import { useLocale } from '../../../providers/LocaleProvider';

import { shotTypeLabels, shotTypes } from '../capture-grid';

import type { FC, ReactNode } from 'react';

import type { ShotType } from '../capture-grid';

export type CaptureCameraProps = {
  /** record name or the new-item label, joined with its code */
  recordLabel: string;
  /** live preview, or a camera-unavailable notice in its place */
  viewfinder: ReactNode;
  shotType: ShotType;
  onShotType: (shotType: ShotType) => void;
  flash: boolean;
  onFlash: () => void;
  /** last photo taken in this session, shown as the review thumbnail */
  lastShotUri: string | null;
  /** photos taken in this session */
  shotCount: number;
  /** a photo is being taken, so the shutter waits */
  busy: boolean;
  /** the last photo could not be taken */
  failed: boolean;
  onShutter: () => void;
  onReview: () => void;
  onSwitch: () => void;
  onClose: () => void;
  /** the assistant pill at the right end of the header, in its on-photo variant */
  askAction?: ReactNode;
};

/** smallest touch target, in dp */
const target = 48;

const layout = StyleSheet.create({
  frame: { flex: 1, backgroundColor: theme.color.camera.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  headerButton: {
    minWidth: target,
    minHeight: target,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 24,
    paddingHorizontal: 8,
  },
  headerText: {
    color: colors.card,
    fontSize: 18,
    ...theme.font.face('sans', '700'),
  },
  title: {
    flex: 1,
    textAlign: 'center',
    color: colors.card,
    fontSize: 20,
    ...theme.font.face('sans', '700'),
  },
  viewfinder: { flex: 1, backgroundColor: '#000' },
  recordChip: {
    position: 'absolute',
    top: 16,
    alignSelf: 'center',
    backgroundColor: 'rgba(38, 61, 53, 0.6)',
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  recordChipText: {
    ...theme.font.face('sans', '400'),
    color: colors.card,
    fontSize: 16,
  },
  panel: {
    backgroundColor: colors.canvas,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 20,
    gap: 16,
  },
  chips: { flexDirection: 'row', gap: 8 },
  chip: {
    flex: 1,
    minHeight: target,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipText: {
    color: colors.text,
    fontSize: 16,
    ...theme.font.face('sans', '600'),
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  lastShot: {
    width: 64,
    height: 64,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  lastShotImage: { width: '100%', height: '100%' },
  shutter: {
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 5,
    borderColor: colors.jade,
    backgroundColor: colors.card,
  },
  switch: {
    width: 64,
    height: 64,
    alignItems: 'center',
    justifyContent: 'center',
  },
  switchText: { color: colors.jade, fontSize: 32 },
  hint: {
    ...theme.font.face('sans', '400'),
    color: colors.muted,
    fontSize: 15,
    textAlign: 'center',
  },
});

/**
 * renders the camera header: close, title, the flash switch and the assistant pill
 * @param props flash state and handlers
 * @param props.flash whether the flash fires
 * @param props.onFlash toggles the flash
 * @param props.onClose leaves the camera
 * @param props.askAction the assistant pill, at the right end
 * @returns the header row
 */
const CameraHeader: FC<
  Pick<CaptureCameraProps, 'flash' | 'onFlash' | 'onClose' | 'askAction'>
> = ({ flash, onFlash, onClose, askAction }) => {
  const { t } = useLocale();

  return (
    <View style={layout.header}>
      <Pressable
        testID="capture-camera-close"
        accessibilityRole="button"
        accessibilityLabel={t('cameraClose')}
        onPress={onClose}
        style={layout.headerButton}>
        <Text style={layout.headerText}>✕</Text>
      </Pressable>
      <Text accessibilityRole="header" style={layout.title}>
        {t('cameraTitle')}
      </Text>
      <Pressable
        testID="capture-camera-flash"
        accessibilityRole="switch"
        accessibilityLabel={t('cameraFlash')}
        accessibilityState={{ checked: flash }}
        onPress={onFlash}
        style={[
          layout.headerButton,
          flash && { backgroundColor: colors.card },
        ]}>
        <Text style={[layout.headerText, flash && { color: colors.jade }]}>
          {t('cameraFlash')}
        </Text>
      </Pressable>
      {askAction}
    </View>
  );
};

/**
 * renders the shot-type chips as one radio group
 * @param props selected shot type and its handler
 * @param props.shotType selected shot type
 * @param props.onShotType selects a shot type
 * @returns the chip row
 */
const ShotTypeChips: FC<
  Pick<CaptureCameraProps, 'shotType' | 'onShotType'>
> = ({ shotType, onShotType }) => {
  const { t } = useLocale();

  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={t('cameraShotType')}
      style={layout.chips}>
      {shotTypes.map((type) => {
        const checked = type === shotType;

        return (
          <Pressable
            key={type}
            testID={`capture-camera-shot-${type}`}
            accessibilityRole="radio"
            accessibilityLabel={t(shotTypeLabels[type])}
            accessibilityState={{ checked }}
            onPress={() => onShotType(type)}
            style={[
              layout.chip,
              checked && {
                backgroundColor: colors.jade,
                borderColor: colors.jade,
              },
            ]}>
            <Text style={[layout.chipText, checked && { color: colors.card }]}>
              {t(shotTypeLabels[type])}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
};

/**
 * renders the last-shot thumbnail, the shutter and the camera switch
 * @param props shot state and handlers
 * @param props.lastShotUri last photo of this session
 * @param props.shotCount photos taken in this session
 * @param props.busy a photo is being taken
 * @param props.onShutter takes a photo
 * @param props.onReview opens the grid to review the photos
 * @param props.onSwitch switches between the back and front cameras
 * @returns the control row
 */
const CameraControls: FC<
  Pick<
    CaptureCameraProps,
    'lastShotUri' | 'shotCount' | 'busy' | 'onShutter' | 'onReview' | 'onSwitch'
  >
> = ({ lastShotUri, shotCount, busy, onShutter, onReview, onSwitch }) => {
  const { t } = useLocale();

  return (
    <View style={layout.controls}>
      <Pressable
        testID="capture-camera-last-shot"
        accessibilityRole="button"
        accessibilityLabel={t('cameraLastShot', { count: shotCount })}
        accessibilityState={{ disabled: !lastShotUri }}
        disabled={!lastShotUri}
        onPress={onReview}
        style={layout.lastShot}>
        {lastShotUri && (
          <Image
            source={{ uri: lastShotUri }}
            // decode the full-size photo at thumbnail size
            resizeMethod="resize"
            style={layout.lastShotImage}
          />
        )}
      </Pressable>
      <Pressable
        testID="capture-camera-shutter"
        accessibilityRole="button"
        accessibilityLabel={t('cameraShutter')}
        accessibilityState={{ disabled: busy, busy }}
        disabled={busy}
        onPress={onShutter}
        style={[layout.shutter, busy && { opacity: 0.5 }]}
      />
      <Pressable
        testID="capture-camera-switch"
        accessibilityRole="button"
        accessibilityLabel={t('cameraSwitch')}
        onPress={onSwitch}
        style={layout.switch}>
        <Text style={layout.switchText}>↻</Text>
      </Pressable>
    </View>
  );
};

/**
 * renders the in-app camera (B02): close, title and flash above the viewfinder, then shot-type
 * chips, the last-shot review thumbnail, the shutter, the camera switch and the capture hint
 * @param props camera state and handlers
 * @param props.recordLabel record name or new-item label with its code
 * @param props.viewfinder live preview content
 * @param props.shotCount photos taken in this session
 * @param props.failed the last photo could not be taken
 * @returns the full-screen camera layout
 */
export const CaptureCamera: FC<CaptureCameraProps> = ({
  recordLabel,
  viewfinder,
  shotCount,
  failed,
  ...controls
}) => {
  const { t } = useLocale();

  return (
    <View testID="capture-camera" style={layout.frame}>
      <CameraHeader {...controls} />
      <View style={layout.viewfinder}>
        {viewfinder}
        <View testID="capture-camera-record" style={layout.recordChip}>
          <Text style={layout.recordChipText}>{recordLabel}</Text>
        </View>
      </View>
      <View style={layout.panel}>
        <ShotTypeChips {...controls} />
        <CameraControls shotCount={shotCount} {...controls} />
        <Text style={layout.hint}>{t('cameraHint')}</Text>
        {failed && (
          <Text accessibilityRole="alert" style={styles.error}>
            {t('cameraShotFailed')}
          </Text>
        )}
        {shotCount > 0 && (
          <Text
            testID="capture-camera-shot-count"
            accessibilityLiveRegion="polite"
            style={layout.hint}>
            {t('cameraShotSaved', { count: shotCount })}
          </Text>
        )}
      </View>
    </View>
  );
};
