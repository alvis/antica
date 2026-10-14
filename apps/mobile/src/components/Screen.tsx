import { ScrollView, Text, View } from 'react-native';

import { SafeAreaView } from 'react-native-safe-area-context';

import { styles } from '@antica/ui';

import type { FC, PropsWithChildren, Ref } from 'react';

export type ScreenProps = PropsWithChildren<{
  title?: string;
  subtitle?: string;
  scrollable?: boolean;
  /** optional handle for scrolling to content after layout */
  scrollRef?: Ref<ScrollView>;
}>;

export const Screen: FC<ScreenProps> = ({
  children,
  title,
  subtitle,
  scrollable = true,
  scrollRef,
}) => {
  const heading = (title || subtitle) && (
    <View>
      {title && (
        <Text accessibilityRole="header" style={styles.title}>
          {title}
        </Text>
      )}
      {subtitle && <Text style={styles.secondary}>{subtitle}</Text>}
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
