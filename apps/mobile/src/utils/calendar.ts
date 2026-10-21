import type { Locale } from '../i18n/resources';

/** names for the two days a collector reads as words rather than dates */
export interface RelativeDayLabels {
  readonly today: string;
  readonly yesterday: string;
}

const dayMilliseconds = 86_400_000;

// dates are put together here from numbers and single-field names, never from ICU's own
// patterns: ICU versions disagree on their literals (10月20日 星期二 or 10月20日星期二, 下午2:46 or
// 下午 2:46, a narrow no-break space before PM), and the design fixes one spelling
const noon = 12;
const minuteDigits = 2;

/**
 * names one field of a date, a format with that field alone and so without literals
 * @param date the day
 * @param locale active interface locale
 * @param field the weekday, such as 星期二, or the month, such as October
 * @returns the field's long name in the interface language
 */
function fieldName(
  date: Date,
  locale: Locale,
  field: 'weekday' | 'month',
): string {
  return new Intl.DateTimeFormat(locale, { [field]: 'long' }).format(date);
}

/**
 * spells a month and day, such as 10月20日 or October 20
 * @param date the local calendar day to spell
 * @param locale active interface locale
 * @returns month and day in the interface language
 */
function monthDay(date: Date, locale: Locale): string {
  return locale === 'zh-Hant'
    ? `${date.getMonth() + 1}月${date.getDate()}日`
    : `${fieldName(date, locale, 'month')} ${date.getDate()}`;
}

/**
 * formats a day as the heading over 今天, such as 10月20日 星期二
 * @param date the day to show
 * @param locale active interface locale
 * @returns month, day and weekday in the interface language
 */
export function formatDayHeading(date: Date, locale: Locale): string {
  const weekday = fieldName(date, locale, 'weekday');

  return locale === 'zh-Hant'
    ? `${monthDay(date, locale)} ${weekday}`
    : `${weekday}, ${monthDay(date, locale)}`;
}

/**
 * formats a time of day on a 12-hour clock, such as 下午 2:46 or 2:46 PM
 * @param instant ISO instant
 * @param locale active interface locale
 * @returns hour and minute in the interface language
 */
export function formatTimeOfDay(instant: string, locale: Locale): string {
  const time = new Date(Date.parse(instant));
  const hours = time.getHours();
  const clock = `${hours % noon || noon}:${String(time.getMinutes()).padStart(minuteDigits, '0')}`;
  const afternoon = hours >= noon;

  return locale === 'zh-Hant'
    ? `${afternoon ? '下午' : '上午'} ${clock}`
    : `${clock} ${afternoon ? 'PM' : 'AM'}`;
}

/**
 * formats a date without its time, such as 2026年10月20日 or October 20, 2026
 * @param instant ISO instant
 * @param locale active interface locale
 * @returns year, month and day in the interface language
 */
export function formatDate(instant: string, locale: Locale): string {
  const date = new Date(Date.parse(instant));

  return locale === 'zh-Hant'
    ? `${date.getFullYear()}年${monthDay(date, locale)}`
    : `${monthDay(date, locale)}, ${date.getFullYear()}`;
}

/**
 * formats a full date and time, such as 2026年10月20日 下午 2:46 or October 20, 2026, 2:46 PM
 * @param instant ISO instant
 * @param locale active interface locale
 * @returns year, month, day and time in the interface language
 */
export function formatDateTime(instant: string, locale: Locale): string {
  const separator = locale === 'zh-Hant' ? ' ' : ', ';

  return `${formatDate(instant, locale)}${separator}${formatTimeOfDay(instant, locale)}`;
}

/**
 * formats a day and time without the year, such as 10月20日 下午 2:46 or October 20, 2:46 PM
 * @param instant ISO instant
 * @param locale active interface locale
 * @returns month, day and time in the interface language
 */
export function formatMonthDayTime(instant: string, locale: Locale): string {
  const separator = locale === 'zh-Hant' ? ' ' : ', ';

  return `${monthDay(new Date(Date.parse(instant)), locale)}${separator}${formatTimeOfDay(instant, locale)}`;
}

/**
 * names the day of an instant relative to now: today, yesterday, or its month and day
 * @param instant ISO instant
 * @param now the current moment on the device
 * @param locale active interface locale
 * @param labels words for today and yesterday
 * @returns the day as the shelf shows it
 */
export function formatRelativeDay(
  instant: string,
  now: Date,
  locale: Locale,
  labels: RelativeDayLabels,
): string {
  const day = new Date(Date.parse(instant));
  const daysAgo = Math.round(
    (startOfDay(now) - startOfDay(day)) / dayMilliseconds,
  );
  if (daysAgo === 0) {
    return labels.today;
  }
  if (daysAgo === 1) {
    return labels.yesterday;
  }

  return monthDay(day, locale);
}

/**
 * finds local midnight of a day
 * @param date any moment of the day
 * @returns milliseconds since the epoch at local midnight
 */
function startOfDay(date: Date): number {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  ).getTime();
}
