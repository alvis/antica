import { draftKeys, lengthUnits, weightUnits } from './record-edit-draft';

import type { Measurement, RecordPatch } from '@antica/contracts';

import type { PlainMessageKey } from '../../i18n/messages';
import type { PeriodValue, PurchaseValue } from '../../utils/field-value';

import type {
  MeasurementDraft,
  RecordEditDraft,
  RecordEditField,
} from './record-edit-draft';

/** one field's value as the record stores it; `null` means unknown */
export type RecordEditValue =
  | string
  | number
  | null
  | readonly string[]
  | PeriodValue
  | Measurement
  | PurchaseValue;

/** a field read from the form: its value, or the reason it cannot be saved */
export type ParsedField =
  | { readonly ok: true; readonly value: RecordEditValue }
  | { readonly ok: false; readonly error: PlainMessageKey };

type Parser = (draft: RecordEditDraft) => ParsedField;

/**
 * a decimal as every supported language writes it: a point separates the fraction,
 * so a comma, which those languages use to group thousands, is refused rather than misread
 */
const decimalPattern = /^\d+(?:\.\d+)?$/;
const wholePattern = /^\d+$/;
const yearPattern = /^-?\d{1,4}$/;
const datePattern = /^(\d{4})-(\d{2})-(\d{2})$/;
const currencyPattern = /^[A-Z]{3}$/;

/**
 * reads text whose empty value means unknown
 * @param text typed text
 * @returns the trimmed text, or null when nothing was typed
 */
function optionalText(text: string): string | null {
  return text.trim() || null;
}

/**
 * reads one measurement, leaving an empty value unknown
 * @param draft typed number and chosen unit
 * @param units units this dimension accepts
 * @returns the measurement, unknown, or why it is invalid
 */
function parseMeasurement(
  draft: MeasurementDraft,
  units: readonly string[],
): ParsedField {
  const text = draft.value.trim();
  if (!text) {
    return { ok: true, value: null };
  }
  const value = Number(text);
  if (!decimalPattern.test(text) || value <= 0 || !units.includes(draft.unit)) {
    return { ok: false, error: 'editPositiveNumber' };
  }

  return { ok: true, value: { value, unit: draft.unit } as Measurement };
}

/**
 * reads the candidate period with its years and whose judgment it is
 * @param draft form state
 * @returns the period, unknown, or why it is invalid
 */
function parsePeriod(draft: RecordEditDraft): ParsedField {
  const label = draft.periodLabel.trim();
  const from = draft.periodFrom.trim();
  const to = draft.periodTo.trim();
  if (!label) {
    return from || to
      ? { ok: false, error: 'editPeriodLabelRequired' }
      : { ok: true, value: null };
  }
  if ([from, to].some((year) => year && !yearPattern.test(year))) {
    return { ok: false, error: 'editYear' };
  }
  if (from && to && Number(from) > Number(to)) {
    return { ok: false, error: 'editYearOrder' };
  }

  return {
    ok: true,
    value: {
      label,
      ...(from ? { fromYear: Number(from) } : {}),
      ...(to ? { toYear: Number(to) } : {}),
      status: draft.periodStatus,
    },
  };
}

/**
 * reads the acquisition date, which may be known without a time
 * @param draft form state
 * @returns the calendar date, unknown, or why it is invalid
 */
function parseAcquiredOn(draft: RecordEditDraft): ParsedField {
  const text = draft.acquiredOn.trim();
  if (!text) {
    return { ok: true, value: null };
  }
  const match = datePattern.exec(text);
  const [, year, month, day] = match ?? [];
  const date = new Date(`${text}T00:00:00Z`);
  const valid =
    match !== null &&
    date.getUTCFullYear() === Number(year) &&
    date.getUTCMonth() + 1 === Number(month) &&
    date.getUTCDate() === Number(day);

  return valid ? { ok: true, value: text } : { ok: false, error: 'editDate' };
}

/**
 * reads the historical purchase amount, which is saved only with its currency
 * @param draft form state
 * @returns the amount and currency, unknown, or why they are invalid
 */
function parsePurchase(draft: RecordEditDraft): ParsedField {
  const amount = draft.amount.trim();
  const currency = draft.currency.trim().toUpperCase();
  if (!amount && !currency) {
    return { ok: true, value: null };
  }
  if (!amount) {
    return { ok: false, error: 'editCurrencyNeedsAmount' };
  }
  if (!decimalPattern.test(amount)) {
    return { ok: false, error: 'editAmount' };
  }
  if (!currencyPattern.test(currency)) {
    return {
      ok: false,
      error: currency ? 'editCurrency' : 'editAmountNeedsCurrency',
    };
  }

  return { ok: true, value: { amount, currency } };
}

/**
 * reads the piece count, a positive whole number when known
 * @param draft form state
 * @returns the count, unknown, or why it is invalid
 */
function parsePieceCount(draft: RecordEditDraft): ParsedField {
  const text = draft.pieceCount.trim();
  if (!text) {
    return { ok: true, value: null };
  }

  return wholePattern.test(text) && Number(text) > 0
    ? { ok: true, value: Number(text) }
    : { ok: false, error: 'editWholeNumber' };
}

const parsers: Readonly<Record<RecordEditField, Parser>> = {
  name: (draft) => ({ ok: true, value: optionalText(draft.name) }),
  categoryIds: (draft) => ({ ok: true, value: draft.categoryIds }),
  materialIds: (draft) => ({ ok: true, value: draft.materialIds }),
  period: parsePeriod,
  collectorJudgment: (draft) => ({
    ok: true,
    value: optionalText(draft.collectorJudgment),
  }),
  height: (draft) => parseMeasurement(draft.height, lengthUnits),
  width: (draft) => parseMeasurement(draft.width, lengthUnits),
  depth: (draft) => parseMeasurement(draft.depth, lengthUnits),
  diameter: (draft) => parseMeasurement(draft.diameter, lengthUnits),
  seatHeight: (draft) => parseMeasurement(draft.seatHeight, lengthUnits),
  weight: (draft) => parseMeasurement(draft.weight, weightUnits),
  surface: (draft) => ({ ok: true, value: optionalText(draft.surface) }),
  condition: (draft) => ({ ok: true, value: optionalText(draft.condition) }),
  pieceCount: parsePieceCount,
  tags: (draft) => ({ ok: true, value: draft.tags }),
  acquiredOn: parseAcquiredOn,
  seller: (draft) => ({ ok: true, value: optionalText(draft.seller) }),
  method: (draft) => ({ ok: true, value: optionalText(draft.method) }),
  purchase: parsePurchase,
  provenanceNote: (draft) => ({
    ok: true,
    value: optionalText(draft.provenanceNote),
  }),
  receiptAssetIds: (draft) => ({ ok: true, value: draft.receiptAssetIds }),
  description: (draft) => ({ ok: true, value: draft.description }),
  locationId: (draft) => ({ ok: true, value: draft.locationId }),
  locationDetail: (draft) => ({
    ok: true,
    value: draft.locationDetail.trim(),
  }),
};

/** fields whose order carries no meaning, so a reordering is no change */
const unorderedFields = new Set<RecordEditField>([
  'categoryIds',
  'materialIds',
  'tags',
  'receiptAssetIds',
]);

/**
 * reads one field from the form
 * @param draft form state
 * @param field field to read
 * @returns its value as the record stores it, or why it cannot be saved
 */
export function parseField(
  draft: RecordEditDraft,
  field: RecordEditField,
): ParsedField {
  return parsers[field](draft);
}

/**
 * compares a field between two form states by the value each would save, so
 * reordering a selection or adding surrounding spaces is not a change
 * @param left one form state
 * @param right another form state
 * @param field field to compare
 * @returns whether both hold the same saveable value
 */
export function sameField(
  left: RecordEditDraft,
  right: RecordEditDraft,
  field: RecordEditField,
): boolean {
  const canonical = (draft: RecordEditDraft): string => {
    const parsed = parseField(draft, field);
    if (!parsed.ok) {
      // invalid text is compared as typed
      return JSON.stringify(draftKeys(field).map((key) => draft[key]));
    }
    const { value } = parsed;

    return JSON.stringify(
      unorderedFields.has(field) && Array.isArray(value)
        ? [...(value as readonly string[])].sort()
        : value,
    );
  };

  return canonical(left) === canonical(right);
}

/** the record fields a measurement, acquisition, or location field belongs to */
export type RecordFieldsPatch = RecordPatch['fields'];
