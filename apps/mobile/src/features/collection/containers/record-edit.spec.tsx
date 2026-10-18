import { expect, it, jest } from '@jest/globals';
import { screen, waitFor } from '@testing-library/react-native';

import { ApiError } from '@antica/client';

import { collectionRecord } from '../../../mobile.spec.fixtures';

import {
  filledRecord,
  materialId,
  receiptId,
  studyId,
} from '../record-edit.spec.fixtures';

import {
  press,
  recordServer,
  renderEditor,
  type,
} from './record-edit.spec.fixtures';

jest.mock('../../../providers/AuthProvider', () => ({ useAuth: jest.fn() }));
jest.mock('expo-router', () => ({
  useRouter: jest.fn(),
  useLocalSearchParams: jest.fn(),
}));
jest.mock('expo-crypto', () => ({
  randomUUID:
    jest.requireActual<typeof import('node:crypto')>('node:crypto').randomUUID,
}));

/** what the collector types into every field of an unknown record */
const typedValues: ReadonlyArray<readonly [string, string]> = [
  ['name', ' Blue bowl '],
  ['height', '12.5'],
  ['weight', '1.2'],
  ['piece-count', '2'],
  ['period', 'Kangxi'],
  ['period-from', '1662'],
  ['period-to', '1722'],
  ['collector-judgment', 'Looks period'],
  ['acquired-on', '2024-05-18'],
  ['seller', 'Dealer'],
  ['method', 'Purchase'],
  ['purchase', '1200'],
  ['currency', 'hkd'],
  ['provenance-note', 'Family collection'],
  ['description', 'Bowl with a blue rim'],
  ['tags', 'bowl'],
  ['location-detail', 'Second shelf'],
];

/** the PATCH fields those entries produce */
const everyFieldPatch = {
  name: 'Blue bowl',
  period: {
    label: 'Kangxi',
    fromYear: 1662,
    toYear: 1722,
    status: 'unconfirmed',
  },
  collectorJudgment: 'Looks period',
  dimensions: {
    height: { value: 12.5, unit: 'mm' },
    weight: { value: 1.2, unit: 'kg' },
  },
  pieceCount: 2,
  tags: ['bowl'],
  acquisition: {
    receiptAssetIds: [],
    acquiredOn: '2024-05-18',
    seller: 'Dealer',
    method: 'Purchase',
    amount: '1200',
    currency: 'HKD',
    provenanceNote: 'Family collection',
  },
  description: 'Bowl with a blue rim',
  location: { locationId: studyId, detail: 'Second shelf' },
};

/** fills every field of the editor, choosing units, a period source, a tag, and a location */
async function fillEveryField(): Promise<void> {
  for (const [field, text] of typedValues) {
    await type(field, text);
  }
  for (const id of [
    'record-edit-height-unit-mm',
    'record-edit-weight-unit-kg',
    'record-edit-period-status-unconfirmed',
    'record-edit-tag-add',
    `record-edit-location-option-${studyId}`,
  ]) {
    await press(id);
  }
}

it('should start an unknown record empty and save only what the collector entered', async () => {
  const server = recordServer({ ...collectionRecord, pieceCount: null });
  const view = await renderEditor(server);

  for (const field of ['name', 'height', 'piece-count', 'location-detail']) {
    expect(screen.getByTestId(`record-edit-field-${field}`)).toHaveProp(
      'value',
      '',
    );
  }
  expect(screen.getByTestId('record-edit-location-none')).toHaveProp(
    'accessibilityState',
    { checked: true },
  );
  expect(
    screen.getByText(
      'This item has no receipt photos yet. Add one through Add evidence.',
    ),
  ).toBeTruthy();

  await fillEveryField();
  await press('record-edit-save');

  await waitFor(() => expect(view.router.back).toHaveBeenCalledTimes(1));
  expect(server.bodies).toEqual([
    { expectedRevision: 1, fields: everyFieldPatch },
  ]);
  expect(view.client.getQueryData(['record', collectionRecord.id])).toEqual(
    server.record,
  );
});

it('should clear known values with null or omission and leave untouched fields out', async () => {
  const server = recordServer(filledRecord);
  await renderEditor(server);
  await screen.findByText('receipt.jpg');

  await type('name', '');
  await type('height', '');
  await type('purchase', '');
  await type('currency', '');
  await type('period', '');
  await type('period-from', '');
  await type('period-to', '');
  await press('record-edit-tag-bowl');
  await press(`record-edit-receipt-${receiptId}`);
  await press(`record-edit-field-material-ids-option-${materialId}`);
  await press('record-edit-location-none');
  await press('record-edit-save');

  await waitFor(() => expect(server.bodies).toHaveLength(1));
  expect(server.bodies[0]).toEqual({
    expectedRevision: 4,
    fields: {
      name: null,
      materialIds: [],
      period: null,
      dimensions: {
        diameter: { value: 160, unit: 'mm' },
        weight: { value: 320, unit: 'g' },
      },
      tags: ['porcelain'],
      acquisition: {
        acquiredOn: '2024-05-18',
        seller: 'Hollywood Road dealer',
        method: 'Purchase',
        receiptAssetIds: [],
        provenanceNote: 'From a Hong Kong family collection',
      },
      location: { locationId: null, detail: 'Second shelf' },
    },
  });
});

it('should block saving and announce each invalid value beside its field', async () => {
  const server = recordServer(collectionRecord);
  await renderEditor(server);

  await type('height', '0');
  await type('piece-count', 'two');
  await type('period-from', '1662');
  await type('acquired-on', '2023-02-30');
  await type('purchase', '1200');
  await press('record-edit-save');

  expect(screen.getByTestId('record-edit-invalid')).toHaveTextContent(
    'Some fields need attention before saving.',
  );
  expect(
    screen.getByTestId('record-edit-field-height-error'),
  ).toHaveTextContent(
    'Enter a number greater than zero, or leave it empty if unknown.',
  );
  expect(screen.getByTestId('record-edit-field-piece-count-error')).toHaveProp(
    'accessibilityRole',
    'alert',
  );
  expect(
    screen.getByTestId('record-edit-field-period-error'),
  ).toHaveTextContent('Name the period before adding years.');
  expect(
    screen.getByTestId('record-edit-field-acquired-on-error'),
  ).toHaveTextContent('Enter a real date as YYYY-MM-DD.');
  expect(
    screen.getByTestId('record-edit-field-purchase-error'),
  ).toHaveTextContent('Add the currency of this amount.');
  expect(screen.getByTestId('record-edit-field-height')).toHaveProp(
    'accessibilityHint',
    'Enter a number greater than zero, or leave it empty if unknown.',
  );
  expect(server.bodies).toEqual([]);

  // a corrected value clears its error at once
  await type('height', '3');
  expect(screen.queryByTestId('record-edit-field-height-error')).toBeNull();
});

it('should close without a request when nothing changed', async () => {
  const server = recordServer(filledRecord);
  const view = await renderEditor(server);

  // retyping a value as it was is no change
  await type('name', 'Blue-and-white bowl');
  await press('record-edit-save');

  expect(view.router.back).toHaveBeenCalledTimes(1);
  expect(server.bodies).toEqual([]);
  await press('record-edit-cancel');
  expect(view.router.back).toHaveBeenCalledTimes(2);
});

it('should keep the edit after a rejected save and retry it under the same key', async () => {
  const server = recordServer(collectionRecord);
  const view = await renderEditor(server);
  view.patches.mockRejectedValueOnce(
    new ApiError({
      status: 422,
      code: 'VALIDATION_FAILED',
      message: 'server text',
    }),
  );

  await type('name', 'Bowl');
  await press('record-edit-save');
  expect(await screen.findByTestId('record-edit-error')).toHaveTextContent(
    'This could not be accepted. Check it and try again.',
  );
  expect(screen.getByTestId('record-edit-field-name')).toHaveProp(
    'value',
    'Bowl',
  );
  await press('record-edit-save');

  await waitFor(() => expect(view.router.back).toHaveBeenCalled());
  const keys = view.patches.mock.calls.map(
    ([, , options]) => options.idempotencyKey,
  );
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBe(keys[1]);
});
