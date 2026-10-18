import { CameraView } from 'expo-camera';
import { useState } from 'react';
import { Linking, Modal, StyleSheet, View } from 'react-native';

import { SafeAreaView } from 'react-native-safe-area-context';

import { colors } from '@antica/ui';

import { useLocale } from '../../../providers/LocaleProvider';

import { CaptureCamera } from '../components/CaptureCamera';
import { CaptureCameraFallback } from '../components/CaptureCameraFallback';
import { useCameraShots } from '../hooks/useCameraShots';

import type { FC } from 'react';

import type { LocalMedia } from '../../../adapters/media-upload';

export type CaptureCameraContainerProps = {
  /** name of the record the photos belong to, or the new-item label */
  recordName: string;
  recordCode: string;
  /** adds one photo to the draft as soon as it is taken */
  onShot: (file: LocalMedia) => void;
  /** leaves the camera and imports photos from the library instead */
  onImport: () => void;
  /** leaves the camera and opens the grid to review the photos */
  onReview: () => void;
  /** leaves the camera where it was opened */
  onClose: () => void;
};

const layout = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.jade },
  preview: StyleSheet.absoluteFill,
});

/**
 * runs the in-app multi-shot camera: every shot joins the draft at once while the collector
 * keeps shooting; a denied or failed camera falls back to library import
 * @param props draft record and handlers
 * @param props.recordName record name or the new-item label
 * @param props.recordCode code identifying the record, such as AC-0001
 * @param props.onShot adds a taken photo to the draft
 * @param props.onImport imports from the library instead
 * @param props.onReview opens the grid
 * @param props.onClose leaves the camera
 * @returns the camera in a full-screen modal
 */
export const CaptureCameraContainer: FC<CaptureCameraContainerProps> = ({
  recordName,
  recordCode,
  onShot,
  onImport,
  onReview,
  onClose,
}) => {
  const { t } = useLocale();
  const shots = useCameraShots(onShot);
  const [flash, setFlash] = useState(false);
  const [facing, setFacing] = useState<'back' | 'front'>('back');

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={layout.safe} edges={['top', 'bottom']}>
        {shots.fallback ? (
          <CaptureCameraFallback
            reason={shots.fallback}
            onOpenSettings={() => void Linking.openSettings()}
            onImport={onImport}
            onClose={onClose}
          />
        ) : (
          <CaptureCamera
            {...shots}
            recordLabel={t('cameraRecord', {
              name: recordName,
              code: recordCode,
            })}
            viewfinder={
              shots.granted ? (
                <CameraView
                  ref={shots.camera}
                  testID="capture-camera-preview"
                  style={layout.preview}
                  facing={facing}
                  flash={flash ? 'on' : 'off'}
                  onMountError={shots.markUnavailable}
                />
              ) : (
                <View testID="capture-camera-waiting" />
              )
            }
            onShotType={shots.setShotType}
            flash={flash}
            onFlash={() => setFlash((value) => !value)}
            busy={shots.busy || !shots.granted}
            onShutter={() => void shots.shoot()}
            onReview={onReview}
            onSwitch={() =>
              setFacing((value) => (value === 'back' ? 'front' : 'back'))
            }
            onClose={onClose}
          />
        )}
      </SafeAreaView>
    </Modal>
  );
};
