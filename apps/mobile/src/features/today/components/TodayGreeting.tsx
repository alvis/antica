import { StyleSheet, Text, View } from 'react-native';

import { ActionButton, AssistantSeal, theme } from '@antica/ui';

import { useLocale } from '../../../providers/LocaleProvider';

import type { FC } from 'react';

/** how far 今天 has read what waits: all of it, some of it still, or not all of it could be read */
export type TodayGreetingState = 'settled' | 'checking' | 'incomplete';

/** properties for the assistant's opening line on 今天 */
export type TodayGreetingProps = {
  /** hour of the day on the device, which picks 早安 / 午安 / 晚安 */
  hour: number;
  /** how many inbox cards wait for the collector */
  waitingCount: number;
  /** whether the count is final; until it is, the line never says that nothing waits */
  state: TodayGreetingState;
  /** rereads what could not be read */
  onRetry: () => void;
};

/** the first afternoon and evening hours */
const afternoonHour = 12;
const eveningHour = 18;

const layout = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: theme.space[12] },
  body: { flex: 1, gap: theme.space[8] },
  text: {
    ...theme.type.body,
    lineHeight: 25,
    color: theme.color.text.primary,
  },
  count: { ...theme.font.face('sans', '700') },
});

/**
 * the assistant's greeting with the number of things waiting, and its promise not to change anything;
 * while records are still read, or some could not be, it says so instead of a count
 * @param root0 greeting properties
 * @param root0.hour hour of the day on the device
 * @param root0.waitingCount how many inbox cards wait
 * @param root0.state whether the count is final
 * @param root0.onRetry rereads what could not be read
 * @returns the seal and its line
 */
export const TodayGreeting: FC<TodayGreetingProps> = ({
  hour,
  waitingCount,
  state,
  onRetry,
}) => {
  const { t } = useLocale();
  const greeting = t(
    hour < afternoonHour
      ? 'todayMorning'
      : hour < eveningHour
        ? 'todayAfternoon'
        : 'todayEvening',
  );

  return (
    <View testID="today-greeting" style={layout.row}>
      <AssistantSeal size="voice" />
      <View style={layout.body}>
        {state === 'incomplete' ? (
          <>
            <Text accessibilityRole="alert" style={layout.text}>
              {t('todayGreetingIncomplete', { greeting })}
            </Text>
            <ActionButton
              testID="today-greeting-retry"
              label={t('retry')}
              onPress={onRetry}
              secondary
            />
          </>
        ) : state === 'checking' ? (
          <Text accessibilityLiveRegion="polite" style={layout.text}>
            {t('todayGreetingChecking', { greeting })}
          </Text>
        ) : waitingCount > 0 ? (
          <Text style={layout.text}>
            {t('todayGreetingLead', { greeting })}
            <Text style={layout.count}>
              {t('todayGreetingCount', { count: waitingCount })}
            </Text>
            {t('todayGreetingTail')}
          </Text>
        ) : (
          <Text style={layout.text}>
            {t('todayGreetingNothing', { greeting })}
          </Text>
        )}
      </View>
    </View>
  );
};
