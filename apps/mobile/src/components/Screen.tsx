import { styles } from '@antica/ui';
import { ScrollView, Text, View } from 'react-native';

import { SafeAreaView } from 'react-native-safe-area-context';

import type { FC, PropsWithChildren } from 'react';

export type ScreenProps = PropsWithChildren<{
  title?: string;
  subtitle?: string;
  scrollable?: boolean;
}>;

export const Screen: FC<ScreenProps> = ({
  children,
  title,
  subtitle,
  scrollable = true,
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
