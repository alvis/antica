import type { Measurement, RecordFields } from '@antica/contracts';

import type { Locale, PlainMessageKey, Translate } from '../i18n/messages';

/** candidate period as the record stores it */
export type PeriodValue = NonNullable<RecordFields['period']>;

/** historical purchase amount with its currency; a transaction record, never a valuation */
export type PurchaseValue = {
  readonly amount: string;
  readonly currency: string;
};

/**
 * a record field value ready for reading, with identifiers already replaced by
 * their labels; `null` and `undefined` both mean the value is unknown
 */
export type FieldDisplayValue =
  | string
  | number
  | null
  | undefined
  | readonly string[]
  | PeriodValue
  | Measurement
  | PurchaseValue;

const periodStatusKeys = {
  collectorClaim: 'periodCollectorClaim',
  unconfirmed: 'periodUnconfirmed',
} as const satisfies Record<PeriodValue['status'], PlainMessageKey>;

/**
 * formats a candidate period with its years and status, so a change of status alone stays visible
 * @param period candidate period
 * @param t translation function for message keys
 * @returns the label, its year range when known, and whose judgment it is
 */
function formatPeriod(period: PeriodValue, t: Translate): string {
  const label =
    period.fromYear === undefined && period.toYear === undefined
      ? period.label
      : t('periodWithYears', {
          label: period.label,
          from: period.fromYear ?? t('unknownYear'),
          to: period.toYear ?? t('unknownYear'),
        });

  return t('periodWithStatus', {
    period: label,
    status: t(periodStatusKeys[period.status]),
  });
}

/**
 * tells whether a value is a list of labels; `Array.isArray` alone does not narrow readonly arrays
 * @param value field value
 * @returns whether the value is a list
 */
function isList(value: FieldDisplayValue): value is readonly string[] {
  return Array.isArray(value);
}

/**
 * renders any record field value as readable text, the same way on every screen
 * that shows record values: the editor, its conflict view, the change history,
 * and suggested changes
 * @param value field value, with identifiers already replaced by labels
 * @param locale active interface locale, which decides number and list separators
 * @param t translation function for message keys
 * @returns the value, or a localized placeholder when it is unknown or empty
 */
export function formatFieldValue(
  value: FieldDisplayValue,
  locale: Locale,
  t: Translate,
): string {
  if (
    value === null ||
    value === undefined ||
    (typeof value === 'string' && value.trim() === '') ||
    (isList(value) && !value.length)
  ) {
    return t('noValue');
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number') {
    return new Intl.NumberFormat(locale).format(value);
  }
  if (isList(value)) {
    return value.join(locale === 'en' ? ', ' : '、');
  }
  if ('unit' in value) {
    return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 6 }).format(value.value)} ${value.unit}`;
  }
  if ('currency' in value) {
    return `${value.amount} ${value.currency}`;
  }

  return formatPeriod(value, t);
}
