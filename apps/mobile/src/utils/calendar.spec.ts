import { afterEach, describe, expect, it, jest } from '@jest/globals';

import {
  formatDate,
  formatDateTime,
  formatDayHeading,
  formatRelativeDay,
  formatTimeOfDay,
} from './calendar';

const labels = { today: 'Today', yesterday: 'Yesterday' };
// the shelf compares local calendar days, so the fixtures are local times
const now = new Date(2026, 9, 20, 9, 30);

describe('fn:formatRelativeDay', () => {
  it('should call any moment of the current local day today', () => {
    expect(
      formatRelativeDay(
        new Date(2026, 9, 20, 0, 5).toISOString(),
        now,
        'en',
        labels,
      ),
    ).toBe('Today');
    expect(
      formatRelativeDay(
        new Date(2026, 9, 20, 23, 55).toISOString(),
        now,
        'en',
        labels,
      ),
    ).toBe('Today');
  });

  it('should call the previous local day yesterday, even late in its evening', () => {
    expect(
      formatRelativeDay(
        new Date(2026, 9, 19, 23, 59).toISOString(),
        now,
        'en',
        labels,
      ),
    ).toBe('Yesterday');
  });

  it('should show older days as their month and day in the interface language', () => {
    const instant = new Date(2026, 9, 17, 12, 0).toISOString();

    expect(formatRelativeDay(instant, now, 'en', labels)).toBe('October 17');
    expect(formatRelativeDay(instant, now, 'zh-Hant', labels)).toBe('10月17日');
  });
});

describe('fn:formatDayHeading', () => {
  it('should name the day with its weekday, as 今天 heads its page', () => {
    expect(formatDayHeading(now, 'zh-Hant')).toBe('10月20日 星期二');
    expect(formatDayHeading(now, 'en')).toBe('Tuesday, October 20');
  });
});

describe('fn:formatTimeOfDay', () => {
  it('should keep a space between the day period and the hour in Traditional Chinese', () => {
    const afternoon = new Date(2026, 9, 20, 14, 46).toISOString();
    const morning = new Date(2026, 9, 20, 0, 5).toISOString();

    expect(formatTimeOfDay(afternoon, 'zh-Hant')).toBe('下午 2:46');
    expect(formatTimeOfDay(morning, 'zh-Hant')).toBe('上午 12:05');
    expect(formatTimeOfDay(afternoon, 'en')).toBe('2:46 PM');
  });
});

describe('fn:formatDateTime', () => {
  it('should join the date and the time with the design spacing', () => {
    const afternoon = new Date(2026, 9, 20, 14, 46).toISOString();

    expect(formatDate(afternoon, 'zh-Hant')).toBe('2026年10月20日');
    expect(formatDateTime(afternoon, 'zh-Hant')).toBe(
      '2026年10月20日 下午 2:46',
    );
    expect(formatDateTime(afternoon, 'en')).toBe('October 20, 2026, 2:46 PM');
  });
});

describe('ICU independence', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should ask ICU only for single names, so its pattern literals never reach the text', () => {
    const native = Intl.DateTimeFormat;
    const requested: Intl.DateTimeFormatOptions[] = [];
    // an ICU whose patterns glue fields together still names a lone weekday or month the same way
    jest
      .spyOn(Intl, 'DateTimeFormat')
      .mockImplementation(
        (
          locale?: Intl.LocalesArgument,
          options?: Intl.DateTimeFormatOptions,
        ) => {
          requested.push(options ?? {});

          return new native(locale, options);
        },
      );
    const afternoon = new Date(2026, 9, 20, 14, 46).toISOString();

    expect(formatDayHeading(now, 'zh-Hant')).toBe('10月20日 星期二');
    expect(formatDateTime(afternoon, 'en')).toBe('October 20, 2026, 2:46 PM');
    expect(
      formatRelativeDay(
        new Date(2026, 9, 17, 12, 0).toISOString(),
        now,
        'zh-Hant',
        labels,
      ),
    ).toBe('10月17日');
    for (const options of requested) {
      expect(Object.keys(options)).toHaveLength(1);
    }
  });
});
