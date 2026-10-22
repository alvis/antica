import { KeyboardAvoidingView, StyleSheet } from 'react-native';

import { SafeAreaView } from 'react-native-safe-area-context';

import { theme } from '@antica/ui';

import type { FC, PropsWithChildren, ReactNode } from 'react';

/** properties for a record segment's frame */
export type RecordSegmentScreenProps = PropsWithChildren<{
  /** the compact record header with its segment bar */
  header: ReactNode;
  /** what stays under the content, such as the 套用 dock or the composer */
  footer?: ReactNode;
  testID?: string;
}>;

const layout = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.color.bg.page },
  body: { flex: 1 },
});

/**
 * the frame of the 建議, 對話 and 紀錄 segments: the compact header on top, the segment's content,
 * and a footer that stays above the soft keyboard
 * @param props frame properties
 * @param props.header the compact record header
 * @param props.footer the dock or composer under the content
 * @param props.testID stable automation identifier
 * @param props.children the segment's content, which fills the space between
 * @returns the frame
 */
export const RecordSegmentScreen: FC<RecordSegmentScreenProps> = ({
  header,
  footer,
  testID,
  children,
}) => (
  <SafeAreaView
    testID={testID}
    style={layout.screen}
    // the bottom edge keeps the dock and composer clear of the gesture bar
    edges={['top', 'left', 'right', 'bottom']}>
    {header}
    {/* edge-to-edge Android no longer resizes the window for the soft keyboard */}
    <KeyboardAvoidingView behavior="padding" style={layout.body}>
      {children}
      {footer}
    </KeyboardAvoidingView>
  </SafeAreaView>
);
