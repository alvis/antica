import { Image, StyleSheet, View } from 'react-native';

import { theme } from '@antica/ui';

import type { FC, PropsWithChildren } from 'react';

import type { StyleProp, ViewStyle } from 'react-native';

/** a collector photo cropped to its frame, on the paper mat while it loads */
export type RecordPhotoProps = PropsWithChildren<{
  /** signed read of the photo; the mat stays while there is none */
  uri: string | null | undefined;
  /** what the photo shows; omitted when the photo only decorates a labelled control */
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}>;

const layout = StyleSheet.create({
  frame: { overflow: 'hidden', backgroundColor: theme.color.bg.photoMat },
});

/**
 * shows a record photo filling its frame, with overlays such as chips laid over it
 * @param root0 photo properties
 * @param root0.uri signed read of the photo
 * @param root0.accessibilityLabel what the photo shows
 * @param root0.style frame size and corners
 * @param root0.testID stable automation identifier
 * @param root0.children overlays drawn above the photo
 * @returns the framed photo
 */
export const RecordPhoto: FC<RecordPhotoProps> = ({
  uri,
  accessibilityLabel,
  style,
  testID,
  children,
}) => (
  <View
    testID={testID}
    accessible={Boolean(accessibilityLabel)}
    accessibilityRole={accessibilityLabel ? 'image' : undefined}
    accessibilityLabel={accessibilityLabel}
    style={[layout.frame, style]}>
    {uri && (
      <Image
        source={{ uri }}
        resizeMode="cover"
        style={StyleSheet.absoluteFill}
      />
    )}
    {children}
  </View>
);
