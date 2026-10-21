import { StyleSheet, Text, View } from 'react-native';

import { ActionButton, AssistantSeal, theme } from '@antica/ui';

import { useLocale } from '../../../providers/LocaleProvider';

import type { FC } from 'react';

/** properties for the first-run card of a collector with no records yet */
export type TodayEmptyCardProps = {
  onCapture: () => void;
};

const layout = StyleSheet.create({
  card: {
    gap: theme.space[12],
    padding: theme.space.card,
    backgroundColor: theme.color.bg.surface,
    borderRadius: theme.radius.card,
    alignItems: 'flex-start',
  },
  say: { flexDirection: 'row', alignItems: 'flex-start', gap: theme.space[12] },
  text: {
    ...theme.type.body,
    flex: 1,
    lineHeight: 25,
    color: theme.color.text.primary,
  },
});

/**
 * the sheet's empty-list card: the assistant says what happens next, with one way to start
 * @param root0 card properties
 * @param root0.onCapture opens the camera for the first object
 * @returns the card
 */
export const TodayEmptyCard: FC<TodayEmptyCardProps> = ({ onCapture }) => {
  const { t } = useLocale();

  return (
    <View testID="today-empty" style={layout.card}>
      <View style={layout.say}>
        <AssistantSeal size="voice" />
        <Text style={layout.text}>{t('todayEmpty')}</Text>
      </View>
      <ActionButton
        testID="today-empty-capture"
        icon="camera"
        label={t('todayCaptureNew')}
        onPress={onCapture}
        secondary
      />
    </View>
  );
};
