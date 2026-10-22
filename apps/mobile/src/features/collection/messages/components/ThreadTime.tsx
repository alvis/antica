import { StyleSheet, Text, View } from 'react-native';

import { theme } from '@antica/ui';

import { useLocale } from '../../../../providers/LocaleProvider';
import { formatRelativeDay, formatTimeOfDay } from '../../../../utils/calendar';

import type { FC } from 'react';

/** properties for the time shown where the conversation resumes */
export type ThreadTimeProps = {
  /** ISO instant of the next message */
  at: string;
};

const layout = StyleSheet.create({
  chip: {
    alignSelf: 'center',
    paddingVertical: theme.space[2],
    paddingHorizontal: theme.space[10],
    borderRadius: 10,
    backgroundColor: theme.color.bg.sunken,
  },
  text: {
    ...theme.font.face('sans', '400'),
    fontSize: 12,
    lineHeight: 18,
    color: theme.color.text.tertiary,
  },
});

/**
 * the thread's time chip (v5 `.when`), such as 今天 上午 9:02
 * @param props chip properties
 * @param props.at the instant shown
 * @returns the chip
 */
export const ThreadTime: FC<ThreadTimeProps> = ({ at }) => {
  const { t, locale } = useLocale();
  const day = formatRelativeDay(at, new Date(), locale, {
    today: t('dayToday'),
    yesterday: t('dayYesterday'),
  });

  return (
    <View style={layout.chip}>
      <Text style={layout.text}>
        {day} {formatTimeOfDay(at, locale)}
      </Text>
    </View>
  );
};
