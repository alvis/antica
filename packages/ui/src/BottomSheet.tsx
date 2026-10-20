import { useEffect, useState } from 'react';
import {
  AccessibilityInfo,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';

import { theme } from './theme.js';

import type { FC, PropsWithChildren, ReactNode } from 'react';

/** properties for a modal sheet that rises from the bottom edge */
export type BottomSheetProps = PropsWithChildren<{
  visible: boolean;
  title: string;
  /** spoken name of the close control */
  closeLabel: string;
  onClose: () => void;
  /** mark shown before the title, such as the assistant seal */
  titleAccessory?: ReactNode;
  testID?: string;
}>;

const sheet = theme.state.bottomSheet;

const layout = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  scrim: { backgroundColor: sheet.scrim },
  panel: {
    backgroundColor: sheet.bg,
    borderTopLeftRadius: sheet.radiusTop,
    borderTopRightRadius: sheet.radiusTop,
    paddingBottom: theme.space[24],
    ...theme.elevation.sheetPicker,
  },
  grab: {
    alignSelf: 'center',
    marginTop: theme.space[8],
    width: sheet.grab.width,
    height: sheet.grab.height,
    borderRadius: sheet.grab.radius,
    backgroundColor: sheet.grab.color,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space[10],
    paddingLeft: theme.space.page,
    paddingRight: theme.space[4],
  },
  title: { ...theme.type.appbar, flex: 1, color: theme.color.text.primary },
  close: {
    width: theme.size.iconButton,
    height: theme.size.iconButton,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeMark: { fontSize: 20, color: theme.color.text.primary },
  body: {
    paddingHorizontal: theme.space.page,
    paddingTop: theme.space[4],
    gap: theme.space.stack,
  },
});

/**
 * tracks the system reduced-motion setting so the sheet appears without sliding when asked
 * @returns whether animations should be skipped
 */
function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (active) {
        setReduced(enabled);
      }
    });
    // react-native-web returns no subscription, whatever the native typing says
    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      setReduced,
    ) as { remove: () => void } | undefined;

    return () => {
      active = false;
      subscription?.remove();
    };
  }, []);

  return reduced;
}

/**
 * renders a modal bottom sheet with a grab handle, a title row and a scrolling body
 * @param root0 sheet properties
 * @param root0.visible whether the sheet is open
 * @param root0.title heading of the sheet
 * @param root0.closeLabel spoken name of the close control
 * @param root0.onClose called by the close control, the scrim and the system back action
 * @param root0.titleAccessory mark before the title
 * @param root0.testID stable automation identifier of the sheet; its panel adds `-panel`
 * @param root0.children sheet content
 * @returns the modal panel over a scrim; nothing shows while closed
 */
export const BottomSheet: FC<BottomSheetProps> = ({
  visible,
  title,
  closeLabel,
  onClose,
  titleAccessory,
  testID,
  children,
}) => {
  const reducedMotion = useReducedMotion();
  const { height } = useWindowDimensions();

  return (
    <Modal
      testID={testID}
      transparent
      statusBarTranslucent
      visible={visible}
      animationType={reducedMotion ? 'none' : 'slide'}
      onRequestClose={onClose}>
      <View style={layout.root}>
        {/* the scrim closes by touch only; the labelled close button is the one accessible control */}
        <Pressable
          importantForAccessibility="no"
          accessibilityElementsHidden
          onPress={onClose}
          style={[StyleSheet.absoluteFill, layout.scrim]}
        />
        <View
          testID={testID && `${testID}-panel`}
          accessibilityViewIsModal
          style={[layout.panel, { maxHeight: height - sheet.maxHeightOffset }]}>
          <View style={layout.grab} />
          <View style={layout.header}>
            {titleAccessory}
            <Text accessibilityRole="header" style={layout.title}>
              {title}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={closeLabel}
              onPress={onClose}
              style={layout.close}>
              <Text
                accessibilityElementsHidden
                importantForAccessibility="no"
                style={layout.closeMark}>
                ✕
              </Text>
            </Pressable>
          </View>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={layout.body}>
            {children}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};
