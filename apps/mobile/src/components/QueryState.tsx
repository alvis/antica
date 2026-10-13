import { ActionButton, styles } from '@antica/ui';
import { useLocale } from '../locale';
import { ActivityIndicator, Text, View } from 'react-native';

import type { FC, PropsWithChildren } from 'react';

export type QueryStateProps = PropsWithChildren<{
  loading: boolean;
  error: Error | null;
  retry: () => void;
}>;

export const QueryState: FC<QueryStateProps> = ({
  children,
  loading,
  error,
  retry,
}) => {
  const { t } = useLocale();
  if (loading) {
    return (
      <View accessible accessibilityRole="progressbar">
        <ActivityIndicator color="#173D35" />
        <Text style={styles.secondary}>{t('loading')}</Text>
      </View>
    );
  }
  if (error) {
    return (
      <View style={styles.card}>
        <Text accessibilityRole="alert" style={styles.error}>
          {error.message || t('error')}
        </Text>
        <ActionButton label={t('retry')} onPress={retry} />
      </View>
    );
  }

  return <>{children}</>;
};
