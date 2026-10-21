import { describe, expect, it, jest } from '@jest/globals';

import { translator } from '../../i18n/translate.spec.fixtures';
import { collectionRecord } from '../../mobile.spec.fixtures';

import { displayValue, editFieldName } from './record-edit-display';
import { draftFromRecord } from './record-edit-draft';
import {
  changedFields,
  conflictingFields,
  fieldErrors,
  patchFields,
  rebaseDraft,
} from './record-edit-patch';
import {
  advanced,
  cabinetId,
  componentId,
  filledRecord,
  materialId,
  receiptId,
  studyId,
} from './record-edit.spec.fixtures';

import type { FieldLabels } from './record-edit-display';

jest.mock('../../providers/AuthProvider', () => ({ useAuth: jest.fn() }));

const filled = draftFromRecord(filledRecord);

describe('fn:changedFields', () => {
  it('should list only the fields the collector changed', () => {
    expect(changedFields(filled, filled)).toEqual([]);
    expect(
      changedFields(filled, {
        ...filled,
        name: 'Bowl',
        periodStatus: 'unconfirmed',
        height: { value: '8.4', unit: 'mm' },
        currency: 'USD',
        locationDetail: 'Top shelf',
      }),
    ).toEqual(['name', 'period', 'height', 'purchase', 'locationDetail']);
  });
});

describe('fn:fieldErrors', () => {
  it('should report each invalid field once and nothing for valid ones', () => {
    const draft = { ...filled, pieceCount: '0', amount: 'a lot', name: 'Bowl' };

    expect(fieldErrors(draft, ['name', 'pieceCount', 'purchase'])).toEqual({
      pieceCount: 'editWholeNumber',
      purchase: 'editAmount',
    });
  });
});

describe('fn:conflictingFields', () => {
  it('should flag only changed fields that also moved on the server', () => {
    const latest = draftFromRecord(
      advanced(filledRecord, {
        name: 'Bowl (server)',
        description: 'Server note',
      }),
    );
    const draft = { ...filled, name: 'My bowl', tags: ['mine'] };

    expect(
      conflictingFields({ base: filled, latest, draft }, ['name', 'tags']),
    ).toEqual(['name']);
    expect(
      conflictingFields(
        {
          base: filled,
          latest: draftFromRecord(advanced(filledRecord)),
          draft,
        },
        ['name'],
      ),
    ).toEqual([]);
  });

  it('should not flag a field the server already holds as the collector typed it', () => {
    const latest = draftFromRecord(
      advanced(filledRecord, { name: 'My bowl', description: 'Server note' }),
    );
    const draft = { ...filled, name: 'My bowl', description: 'My note' };

    expect(
      conflictingFields({ base: filled, latest, draft }, [
        'name',
        'description',
      ]),
    ).toEqual(['description']);
  });
});

describe('fn:rebaseDraft', () => {
  it('should take the newer values for every field the collector does not keep', () => {
    const latest = draftFromRecord(
      advanced(filledRecord, {
        name: 'Server name',
        description: 'Server note',
      }),
    );
    const mine = { ...filled, name: 'My name', tags: ['mine'] };

    expect(rebaseDraft(mine, latest, ['tags'])).toEqual({
      ...latest,
      tags: ['mine'],
    });
  });
});

describe('fn:patchFields', () => {
  it('should send nothing but the changed top-level fields', () => {
    const draft = {
      ...filled,
      name: '  ',
      pieceCount: '',
      tags: ['bowl'],
      periodLabel: '',
      periodFrom: '',
      periodTo: '',
    };

    expect(
      patchFields(filledRecord, draft, [
        'name',
        'pieceCount',
        'tags',
        'period',
      ]),
    ).toEqual({
      name: null,
      pieceCount: null,
      tags: ['bowl'],
      period: null,
    });
  });

  it('should never send a value it cannot read', () => {
    expect(
      patchFields(filledRecord, { ...filled, pieceCount: 'two' }, [
        'pieceCount',
      ]),
    ).toEqual({});
  });

  it('should change one dimension on top of the latest dimensions, keeping its component', () => {
    const draft = {
      ...filled,
      height: { value: '9', unit: 'cm' },
      diameter: { value: '', unit: 'mm' },
      width: { value: '15', unit: 'cm' },
    };
    const latest = advanced(filledRecord, {
      dimensions: {
        ...filledRecord.dimensions,
        depth: { value: 4, unit: 'cm' },
      },
    });

    expect(patchFields(latest, draft, ['height', 'width', 'diameter'])).toEqual(
      {
        dimensions: {
          height: { value: 9, unit: 'cm', componentId },
          diameter: null,
          width: { value: 15, unit: 'cm' },
          depth: { value: 4, unit: 'cm' },
          weight: { value: 320, unit: 'g' },
        },
      },
    );
  });

  it('should change acquisition fields on top of the latest acquisition and clear them with omission', () => {
    const draft = {
      ...filled,
      seller: '',
      amount: '',
      currency: '',
      acquiredOn: '2024-06-01',
      receiptAssetIds: [],
    };

    expect(
      patchFields(filledRecord, draft, [
        'seller',
        'purchase',
        'acquiredOn',
        'receiptAssetIds',
      ]),
    ).toEqual({
      acquisition: {
        acquiredOn: '2024-06-01',
        method: 'Purchase',
        provenanceNote: 'From a Hong Kong family collection',
        receiptAssetIds: [],
      },
    });
    expect(
      patchFields(
        collectionRecord,
        {
          ...draftFromRecord(collectionRecord),
          amount: '800',
          currency: 'GBP',
        },
        ['purchase'],
      ),
    ).toEqual({
      acquisition: { receiptAssetIds: [], amount: '800', currency: 'GBP' },
    });
  });

  it('should save the general and detailed location as two separate fields', () => {
    const draft = {
      ...filled,
      locationId: studyId,
      locationDetail: ' Top drawer ',
    };
    const latest = advanced(filledRecord, {
      location: { locationId: cabinetId, detail: 'Server detail' },
    });

    expect(patchFields(latest, draft, ['locationId'])).toEqual({
      location: { locationId: studyId, detail: 'Server detail' },
    });
    expect(patchFields(latest, draft, ['locationDetail'])).toEqual({
      location: { locationId: cabinetId, detail: 'Top drawer' },
    });
    expect(
      patchFields(latest, { ...draft, locationId: null }, [
        'locationId',
        'locationDetail',
      ]),
    ).toEqual({
      location: { locationId: null, detail: 'Top drawer' },
    });
  });
});

describe('fn:displayValue', () => {
  const labels: FieldLabels = {
    knowledge: (id) => (id === materialId ? 'Porcelain' : 'Bowl'),
    location: () => 'Main display-room cabinet',
    media: () => 'receipt.jpg',
  };

  it('should replace identifiers with their labels', () => {
    expect(displayValue(filled, 'materialIds', labels)).toEqual(['Porcelain']);
    expect(displayValue(filled, 'categoryIds', labels)).toEqual(['Bowl']);
    expect(displayValue(filled, 'locationId', labels)).toBe(
      'Main display-room cabinet',
    );
    expect(displayValue(filled, 'receiptAssetIds', labels)).toEqual([
      'receipt.jpg',
    ]);
    expect(filled.receiptAssetIds).toEqual([receiptId]);
  });

  it('should show unknown, plain, and unsaveable values without labels', () => {
    expect(
      displayValue({ ...filled, locationId: null }, 'locationId', labels),
    ).toBeNull();
    expect(displayValue(filled, 'height', labels)).toEqual({
      value: 8.4,
      unit: 'cm',
    });
    expect(
      displayValue({ ...filled, pieceCount: 'two' }, 'pieceCount', labels),
    ).toBeNull();
  });
});

describe('fn:editFieldName', () => {
  it('should name fields in the collector’s language', () => {
    expect(editFieldName('locationId', translator('en'))).toBe(
      'General location',
    );
    expect(editFieldName('purchase', translator('zh-Hant'))).toBe('購入金額');
  });
});
