import { describe, expect, it } from '@jest/globals';

import { translator } from '../i18n/translate.spec.fixtures';

import { formatFieldValue } from './field-value';

describe('fn:formatFieldValue', () => {
  it.each([null, undefined, '', '   ', []])(
    'should show %p as the empty marker without inventing a value',
    (value) => {
      const t = translator('en');

      expect(formatFieldValue(value, 'en', t)).toBe('(empty)');
    },
  );

  it('should show text, numbers, and lists in the collector’s language', () => {
    const en = translator('en');
    const zh = translator('zh-Hant');

    expect(formatFieldValue('Bowl', 'en', en)).toBe('Bowl');
    expect(formatFieldValue(1200, 'en', en)).toBe('1,200');
    expect(formatFieldValue(['bowl', 'jar'], 'en', en)).toBe('bowl, jar');
    expect(formatFieldValue(['碗', '罐'], 'zh-Hant', zh)).toBe('碗、罐');
  });

  it('should show a measurement with its unit and a purchase with its currency', () => {
    const t = translator('en');

    expect(formatFieldValue({ value: 8.4, unit: 'cm' }, 'en', t)).toBe(
      '8.4 cm',
    );
    expect(
      formatFieldValue({ amount: '1200.50', currency: 'HKD' }, 'en', t),
    ).toBe('1200.50 HKD');
  });

  it('should name each measurement of a size suggestion and mark an empty set as empty', () => {
    const zh = translator('zh-Hant');

    expect(
      formatFieldValue(
        {
          diameter: { value: 21.5, unit: 'cm' },
          height: { value: 102, unit: 'cm' },
          seatHeight: { value: 51, unit: 'cm' },
          weight: { value: 2, unit: 'kg' },
        },
        'zh-Hant',
        zh,
      ),
    ).toBe('高 102 公分·座高 51 公分·徑 21.5 公分·重量 2 kg');
    expect(formatFieldValue({}, 'zh-Hant', zh)).toBe(zh('noValue'));
  });

  it('should show a period with its years and whose judgment it is', () => {
    const t = translator('en');

    expect(
      formatFieldValue({ label: 'Qing', status: 'unconfirmed' }, 'en', t),
    ).toBe('Qing · unconfirmed');
    expect(
      formatFieldValue(
        {
          label: 'Kangxi',
          fromYear: 1662,
          toYear: 1722,
          status: 'collectorClaim',
        },
        'en',
        t,
      ),
    ).toBe('Kangxi (1662–1722) · collector’s claim');
    expect(
      formatFieldValue(
        { label: 'Late Qing', toYear: 1911, status: 'unconfirmed' },
        'en',
        t,
      ),
    ).toBe('Late Qing (unknown–1911) · unconfirmed');
    expect(
      formatFieldValue(
        { label: 'Qing', fromYear: 1644, status: 'unconfirmed' },
        'en',
        t,
      ),
    ).toBe('Qing (1644–unknown) · unconfirmed');
  });
});
