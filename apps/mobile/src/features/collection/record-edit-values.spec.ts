import { describe, expect, it, jest } from '@jest/globals';

import { collectionRecord } from '../../mobile.spec.fixtures';

import { draftFromRecord, draftKeys } from './record-edit-draft';
import { parseField, sameField } from './record-edit-values';
import { filledRecord } from './record-edit.spec.fixtures';

import type { RecordEditDraft, RecordEditField } from './record-edit-draft';

jest.mock('../../providers/AuthProvider', () => ({ useAuth: jest.fn() }));

const empty = draftFromRecord(collectionRecord);
const filled = draftFromRecord(filledRecord);

/**
 * reads one field from a form state changed from the empty record
 * @param patch typed form changes
 * @param field field to read
 * @returns the parsed field
 */
function read(
  patch: Partial<RecordEditDraft>,
  field: RecordEditField,
): ReturnType<typeof parseField> {
  return parseField({ ...empty, ...patch }, field);
}

describe('fn:draftFromRecord', () => {
  it('should leave every unknown field empty instead of inventing a value', () => {
    expect(
      draftFromRecord({ ...collectionRecord, pieceCount: null }),
    ).toMatchObject({
      name: '',
      periodLabel: '',
      periodFrom: '',
      periodTo: '',
      pieceCount: '',
      height: { value: '', unit: 'cm' },
      weight: { value: '', unit: 'g' },
      acquiredOn: '',
      amount: '',
      currency: '',
      locationId: null,
      locationDetail: '',
    });
  });

  it('should hold every known field as the form shows it', () => {
    expect(filled).toMatchObject({
      name: 'Blue-and-white bowl',
      periodLabel: 'Kangxi',
      periodFrom: '1662',
      periodTo: '1722',
      height: { value: '8.4', unit: 'cm' },
      diameter: { value: '160', unit: 'mm' },
      amount: '1200',
      currency: 'HKD',
      locationDetail: 'Second shelf',
    });
  });

  it('should name the form keys of grouped and single fields', () => {
    expect(draftKeys('period')).toEqual([
      'periodLabel',
      'periodFrom',
      'periodTo',
      'periodStatus',
    ]);
    expect(draftKeys('purchase')).toEqual(['amount', 'currency']);
    expect(draftKeys('seller')).toEqual(['seller']);
  });
});

describe('fn:parseField', () => {
  it.each<[Partial<RecordEditDraft>, RecordEditField]>([
    [{}, 'name'],
    [{}, 'collectorJudgment'],
    [{}, 'height'],
    [{}, 'weight'],
    [{ pieceCount: '' }, 'pieceCount'],
    [{}, 'period'],
    [{}, 'acquiredOn'],
    [{}, 'seller'],
    [{}, 'method'],
    [{}, 'purchase'],
    [{}, 'provenanceNote'],
    [{}, 'locationId'],
    [{ name: '   ' }, 'name'],
  ])('should save %p %s as unknown', (patch, field) => {
    expect(read(patch, field)).toEqual({ ok: true, value: null });
  });

  it('should read measurements with their units and a decimal point', () => {
    expect(read({ height: { value: '12.5', unit: 'cm' } }, 'height')).toEqual({
      ok: true,
      value: { value: 12.5, unit: 'cm' },
    });
    expect(read({ weight: { value: '1.2', unit: 'kg' } }, 'weight')).toEqual({
      ok: true,
      value: { value: 1.2, unit: 'kg' },
    });
  });

  it.each([
    { value: '0', unit: 'cm' },
    { value: '-3', unit: 'cm' },
    { value: 'tall', unit: 'cm' },
    { value: '3', unit: 'kg' },
    // a comma groups thousands in every supported language, so it is never read as a decimal point
    { value: '1,200', unit: 'mm' },
  ])('should reject the height %p', (height) => {
    expect(read({ height }, 'height')).toEqual({
      ok: false,
      error: 'editPositiveNumber',
    });
  });

  it('should read the piece count as a positive whole number', () => {
    expect(read({ pieceCount: ' 6 ' }, 'pieceCount')).toEqual({
      ok: true,
      value: 6,
    });
    expect(read({ pieceCount: '0' }, 'pieceCount')).toEqual({
      ok: false,
      error: 'editWholeNumber',
    });
    expect(read({ pieceCount: '1.5' }, 'pieceCount')).toEqual({
      ok: false,
      error: 'editWholeNumber',
    });
  });

  it('should read the period with optional years and its status', () => {
    expect(
      read({ periodLabel: ' Qing ', periodStatus: 'unconfirmed' }, 'period'),
    ).toEqual({
      ok: true,
      value: { label: 'Qing', status: 'unconfirmed' },
    });
    expect(
      read(
        { periodLabel: 'Kangxi', periodFrom: '1662', periodTo: '1722' },
        'period',
      ),
    ).toEqual({
      ok: true,
      value: {
        label: 'Kangxi',
        fromYear: 1662,
        toYear: 1722,
        status: 'collectorClaim',
      },
    });
  });

  it.each<[Partial<RecordEditDraft>, string]>([
    [{ periodFrom: '1662' }, 'editPeriodLabelRequired'],
    [{ periodLabel: 'Qing', periodTo: '19th c.' }, 'editYear'],
    [
      { periodLabel: 'Qing', periodFrom: '1911', periodTo: '1644' },
      'editYearOrder',
    ],
  ])('should reject the period %p with %s', (patch, error) => {
    expect(read(patch, 'period')).toEqual({ ok: false, error });
  });

  it('should read a real acquisition date only', () => {
    expect(read({ acquiredOn: '2024-02-29' }, 'acquiredOn')).toEqual({
      ok: true,
      value: '2024-02-29',
    });
    expect(read({ acquiredOn: '2023-02-29' }, 'acquiredOn')).toEqual({
      ok: false,
      error: 'editDate',
    });
    expect(read({ acquiredOn: 'May 2024' }, 'acquiredOn')).toEqual({
      ok: false,
      error: 'editDate',
    });
  });

  it('should keep a purchase amount only together with its currency', () => {
    expect(read({ amount: '1200.50', currency: 'hkd' }, 'purchase')).toEqual({
      ok: true,
      value: { amount: '1200.50', currency: 'HKD' },
    });
    expect(read({ amount: '1200' }, 'purchase')).toEqual({
      ok: false,
      error: 'editAmountNeedsCurrency',
    });
    expect(read({ currency: 'HKD' }, 'purchase')).toEqual({
      ok: false,
      error: 'editCurrencyNeedsAmount',
    });
    expect(read({ amount: '1,200', currency: 'HKD' }, 'purchase')).toEqual({
      ok: false,
      error: 'editAmount',
    });
    expect(read({ amount: '1200', currency: 'HK$' }, 'purchase')).toEqual({
      ok: false,
      error: 'editCurrency',
    });
  });

  it('should read lists, notes, and both location fields as typed', () => {
    expect(parseField(filled, 'tags')).toEqual({
      ok: true,
      value: ['bowl', 'porcelain'],
    });
    expect(parseField(filled, 'categoryIds')).toEqual({
      ok: true,
      value: filledRecord.categoryIds,
    });
    expect(parseField(filled, 'materialIds')).toEqual({
      ok: true,
      value: filledRecord.materialIds,
    });
    expect(parseField(filled, 'receiptAssetIds')).toEqual({
      ok: true,
      value: filledRecord.acquisition.receiptAssetIds,
    });
    expect(parseField(filled, 'description')).toEqual({
      ok: true,
      value: 'Porcelain bowl.',
    });
    expect(parseField(filled, 'locationId')).toEqual({
      ok: true,
      value: filledRecord.location.locationId,
    });
    expect(read({ locationDetail: ' Shelf 2 ' }, 'locationDetail')).toEqual({
      ok: true,
      value: 'Shelf 2',
    });
    expect(read({ seller: ' Dealer ' }, 'seller')).toEqual({
      ok: true,
      value: 'Dealer',
    });
  });
});

describe('fn:sameField', () => {
  it('should treat a reordered selection and surrounding spaces as no change', () => {
    const reordered = {
      ...filled,
      tags: ['porcelain', 'bowl'],
      name: ' Blue-and-white bowl ',
    };

    expect(sameField(filled, reordered, 'tags')).toBe(true);
    expect(sameField(filled, reordered, 'name')).toBe(true);
  });

  it('should treat a unit chosen for an unknown measurement as no change', () => {
    expect(
      sameField(
        empty,
        { ...empty, height: { value: '', unit: 'mm' } },
        'height',
      ),
    ).toBe(true);
  });

  it('should compare invalid text as typed', () => {
    const invalid = { ...empty, pieceCount: 'two' };

    expect(sameField(empty, invalid, 'pieceCount')).toBe(false);
    expect(sameField(invalid, { ...invalid }, 'pieceCount')).toBe(true);
  });
});
