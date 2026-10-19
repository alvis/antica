/** digits in the longest E.164 country codes */
const longestCodeLength = 3;

/** ITU zones whose country codes are a single digit */
const singleDigitZones = new Set(['1', '7']);

/** two-digit country codes; every other code in zones 2–9 has three digits */
const twoDigitCodes = new Set([
  '20',
  '27',
  '30',
  '31',
  '32',
  '33',
  '34',
  '36',
  '39',
  '40',
  '41',
  '43',
  '44',
  '45',
  '46',
  '47',
  '48',
  '49',
  '51',
  '52',
  '53',
  '54',
  '55',
  '56',
  '57',
  '58',
  '60',
  '61',
  '62',
  '63',
  '64',
  '65',
  '66',
  '81',
  '82',
  '84',
  '86',
  '90',
  '91',
  '92',
  '93',
  '94',
  '95',
  '98',
]);

/** national digits needed before the leading digit is shown alongside the last two */
const minimumDigitsForLeadingDigit = 6;
/** national digits needed before the last two digits are shown */
const minimumDigitsForTrailingDigits = 4;
/** visible trailing digits */
const trailingDigits = 2;
/** digits per displayed group */
const groupSize = 4;
const mask = '•';

/**
 * splits international digits into their E.164 country code and national number
 * @param digits digits after the leading plus sign
 * @returns the country code and the national digits
 */
function splitCountryCode(digits: string): [string, string] {
  const length = singleDigitZones.has(digits.slice(0, 1))
    ? 1
    : twoDigitCodes.has(digits.slice(0, 2))
      ? 2
      : longestCodeLength;

  return [digits.slice(0, length), digits.slice(length)];
}

/**
 * hides a national number except its leading digit and last two digits, grouped in fours
 * @param digits subscriber digits after the country code
 * @returns the masked national number; short numbers reveal fewer digits
 */
function maskNational(digits: string): string {
  const shown =
    digits.length >= minimumDigitsForLeadingDigit
      ? { leading: 1, trailing: trailingDigits }
      : digits.length >= minimumDigitsForTrailingDigits
        ? { leading: 0, trailing: trailingDigits }
        : { leading: 0, trailing: 0 };
  const masked = [...digits]
    .map((digit, index) =>
      index < shown.leading || index >= digits.length - shown.trailing
        ? digit
        : mask,
    )
    .join('');

  return Array.from(
    masked.matchAll(new RegExp(`.{1,${groupSize}}`, 'g')),
    ([group]) => group,
  ).join(' ');
}

/**
 * masks the number a sign-in code was requested for, as on the A02 code screen
 * @param phone number as entered, with or without separators and a leading plus sign
 * @returns e.g. `+852 9••• ••28`: country code, leading digit, and last two digits
 */
export function maskPhoneNumber(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (!phone.trim().startsWith('+')) {
    return maskNational(digits);
  }
  const [countryCode, national] = splitCountryCode(digits);

  return national ? `+${countryCode} ${maskNational(national)}` : '+•••';
}
