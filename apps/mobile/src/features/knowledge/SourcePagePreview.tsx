import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { useEffect, useState } from 'react';
import { Image, Platform, Pressable, Text, View } from 'react-native';

import { ActionButton, styles } from '@antica/ui';

import { useLocale } from '../../locale';

import type { FC } from 'react';
import type { GestureResponderEvent } from 'react-native';

interface WebPointerEvent {
  detail: number;
  clientX: number;
  clientY: number;
}

interface WebPressTarget {
  getBoundingClientRect(): DOMRect;
}

export type SourcePagePreviewProps = {
  uri: string;
  name: string;
  width: number;
  height: number;
  displayWidth: number;
  rotationQuarterTurns: 0 | 1 | 2 | 3;
  crop: {
    kind: 'rect';
    x: number;
    y: number;
    width: number;
    height: number;
  } | null;
  onCrop: (x: number, y: number) => void;
};

const CENTER_CROP_COORDINATES = [0.5, 0.5] as const;

const isWebPointerEvent = (value: unknown): value is WebPointerEvent =>
  typeof value === 'object' &&
  value !== null &&
  'detail' in value &&
  typeof value.detail === 'number' &&
  value.detail > 0 &&
  'clientX' in value &&
  typeof value.clientX === 'number' &&
  'clientY' in value &&
  typeof value.clientY === 'number';

const isWebPressTarget = (value: unknown): value is WebPressTarget =>
  typeof value === 'object' &&
  value !== null &&
  'getBoundingClientRect' in value &&
  typeof value.getBoundingClientRect === 'function';

export const SourcePagePreview: FC<SourcePagePreviewProps> = ({
  uri,
  name,
  width,
  height,
  displayWidth,
  rotationQuarterTurns,
  crop,
  onCrop,
}) => {
  const { t } = useLocale();
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const displayHeight = (displayWidth * height) / width;

  useEffect(() => {
    let active = true;
    setPreviewUri(null);
    setPreviewFailed(false);
    const actions = [
      ...(crop
        ? [
            {
              crop: {
                originX: Math.round(crop.x * width),
                originY: Math.round(crop.y * height),
                width: Math.round(crop.width * width),
                height: Math.round(crop.height * height),
              },
            },
          ]
        : []),
      ...(rotationQuarterTurns ? [{ rotate: rotationQuarterTurns * 90 }] : []),
    ];
    if (!actions.length) {
      setPreviewUri(uri);

      return;
    }
    void manipulateAsync(uri, actions, { format: SaveFormat.JPEG }).then(
      (result) => {
        if (active) {
          setPreviewUri(result.uri);
        }
      },
      () => {
        if (active) {
          setPreviewFailed(true);
        }
      },
    );

    return () => {
      active = false;
    };
  }, [
    uri,
    width,
    height,
    crop?.x,
    crop?.y,
    crop?.width,
    crop?.height,
    rotationQuarterTurns,
    retryCount,
  ]);

  return (
    <View style={{ gap: 12 }}>
      <Text style={styles.secondary}>{t('originalImage')}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('selectRegion')}
        onPress={(event) => {
          const [x, y] = getCropCoordinates(event, displayWidth, displayHeight);
          onCrop(x, y);
        }}>
        <Image
          source={{ uri }}
          style={{ width: displayWidth, height: displayHeight }}
          resizeMode="stretch"
          accessibilityLabel={name}
        />
        {crop && (
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              left: crop.x * displayWidth,
              top: crop.y * displayHeight,
              width: crop.width * displayWidth,
              height: crop.height * displayHeight,
              borderWidth: 3,
              borderColor: '#173D35',
            }}
          />
        )}
      </Pressable>
      <Text style={styles.secondary}>{t('preparedPreview')}</Text>
      {previewUri && (
        <Image
          source={{ uri: previewUri }}
          style={{ width: displayWidth, height: 220 }}
          resizeMode="contain"
          accessibilityLabel={`${name}, ${t('preparedPreview')}`}
        />
      )}
      {previewFailed && (
        <View style={{ gap: 8 }}>
          <Text accessibilityRole="alert" style={styles.error}>
            {t('error')}
          </Text>
          <ActionButton
            label={t('retry')}
            onPress={() => setRetryCount((count) => count + 1)}
            secondary
          />
        </View>
      )}
    </View>
  );
};

/**
 * returns the selected point as original-image fractions
 * @param event press activation
 * @param displayWidth rendered image width
 * @param displayHeight rendered image height
 * @returns normalized image coordinates
 */
function getCropCoordinates(
  event: GestureResponderEvent,
  displayWidth: number,
  displayHeight: number,
): readonly [number, number] {
  const x = event.nativeEvent.locationX / displayWidth;
  const y = event.nativeEvent.locationY / displayHeight;

  if (Number.isFinite(x) && Number.isFinite(y)) {
    return [x, y];
  }

  if (
    Platform.OS === 'web' &&
    isWebPointerEvent(event.nativeEvent) &&
    isWebPressTarget(event.currentTarget)
  ) {
    // react-native-web passes a DOM click, rather than a responder event, to onPress
    const bounds = event.currentTarget.getBoundingClientRect();

    if (bounds.width > 0 && bounds.height > 0) {
      return [
        (event.nativeEvent.clientX - bounds.left) / bounds.width,
        (event.nativeEvent.clientY - bounds.top) / bounds.height,
      ];
    }
  }

  return CENTER_CROP_COORDINATES;
}
