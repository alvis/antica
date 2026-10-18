import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { SafeAreaView } from 'react-native-safe-area-context';

import { styles } from '@antica/ui';

import type { FC, PropsWithChildren, ReactNode, Ref } from 'react';

export type ScreenProps = PropsWithChildren<{
  title?: string;
  subtitle?: string;
  scrollable?: boolean;
  /** optional handle for scrolling to content after layout */
  scrollRef?: Ref<ScrollView>;
  /** optional header control beside the heading, such as the Settings gear */
  action?: ReactNode;
}>;

const layout = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  heading: { flex: 1 },
});

export const Screen: FC<ScreenProps> = ({
  children,
  title,
  subtitle,
  scrollable = true,
  scrollRef,
  action,
}) => {
  const heading = (title || subtitle) && (
    <View style={layout.header}>
      <View style={layout.heading}>
        {title && (
          <Text accessibilityRole="header" style={styles.title}>
            {title}
          </Text>
        )}
        {subtitle && <Text style={styles.secondary}>{subtitle}</Text>}
      </View>
      {action}
    </View>
  );

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
      {scrollable ? (
        <ScrollView
          ref={scrollRef}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.content}>
          {heading}
          {children}
        </ScrollView>
      ) : (
        <>
          {heading && (
            <View style={{ paddingHorizontal: 16, paddingTop: 20 }}>
              {heading}
            </View>
          )}
          {children}
        </>
      )}
    </SafeAreaView>
  );
};
