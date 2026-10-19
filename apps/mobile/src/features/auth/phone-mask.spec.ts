import { describe, expect, it } from '@jest/globals';

import { maskPhoneNumber } from './phone-mask';

describe('fn:maskPhoneNumber', () => {
  it.each([
    [
      'a Hong Kong mobile number as in the mockup',
      '+85291234528',
      '+852 9••• ••28',
    ],
    ['a North American number', '+15550100001', '+1 5••• •••• 01'],
    ['a Russian number', '+79161234567', '+7 9••• •••• 67'],
    ['a two-digit country code', '+447700900123', '+44 7••• •••• 23'],
    ['a three-digit code in a two-digit zone', '+3531234567', '+353 1••• •67'],
    ['separators and surrounding spaces', ' +852 9123 4528 ', '+852 9••• ••28'],
  ])('should mask %s', (_case, phone, masked) => {
    expect(maskPhoneNumber(phone)).toBe(masked);
  });

  it.each([
    [
      'five national digits by showing only the last two',
      '+8521234',
      '+852 ••34',
    ],
    ['three national digits entirely', '+852123', '+852 •••'],
    ['a bare country code entirely', '+852', '+•••'],
    ['a lone plus sign entirely', '+', '+•••'],
    ['an empty entry as nothing', '', ''],
  ])('should mask %s', (_case, phone, masked) => {
    expect(maskPhoneNumber(phone)).toBe(masked);
  });

  it('should mask a number without a plus sign as a national number', () => {
    expect(maskPhoneNumber('9123 4528')).toBe('9••• ••28');
  });
});
