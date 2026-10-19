import { expect, it, jest } from '@jest/globals';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import {
  collectionRecord,
  renderMobile,
  savedLanguage,
} from '../../../mobile.spec.fixtures';

import {
  advanced,
  cabinetId,
  filledRecord,
  objectTypeId,
  otherMaterialId,
  receiptId,
} from '../record-edit.spec.fixtures';

import {
  press,
  recordServer,
  renderEditor,
  type,
} from './record-edit.spec.fixtures';
import { RecordEditContainer } from './RecordEditContainer';

jest.mock('../../../providers/AuthProvider', () => ({ useAuth: jest.fn() }));
jest.mock('expo-router', () => ({
  useRouter: jest.fn(),
  useLocalSearchParams: jest.fn(),
}));
jest.mock('expo-crypto', () => ({
  randomUUID:
    jest.requireActual<typeof import('node:crypto')>('node:crypto').randomUUID,
}));

it('should choose object types and materials from knowledge entries', async () => {
  const server = recordServer(collectionRecord);
  const view = await renderEditor(server);

  await type('category-ids-search', 'bo');
  await fireEvent.press(
    await screen.findByTestId(
      `record-edit-field-category-ids-option-${objectTypeId}`,
    ),
  );
  await fireEvent.press(
    await screen.findByTestId(
      `record-edit-field-material-ids-option-${otherMaterialId}`,
    ),
  );
  await press('record-edit-save');

  await waitFor(() => expect(server.bodies).toHaveLength(1));
  expect(server.bodies[0].fields).toEqual({
    categoryIds: [objectTypeId],
    materialIds: [otherMaterialId],
  });
  expect(view.reads.mock.calls.map(([path]) => path)).toContain(
    '/v1/knowledge?q=bo&limit=20&kinds=object_type',
  );
});

it('should offer a hint when no knowledge entry matches', async () => {
  const server = recordServer(collectionRecord);
  const view = await renderEditor(server);
  view.reads.mockImplementation(async (path) =>
    path.startsWith('/v1/knowledge?')
      ? { items: [], nextCursor: null }
      : server.record,
  );
  await type('material-ids-search', 'jade');

  expect(
    await screen.findAllByText('No matching knowledge entries yet.'),
  ).not.toHaveLength(0);
});

it('should add a new general location and select it', async () => {
  const server = recordServer(collectionRecord);
  const view = await renderEditor(server);

  expect(screen.getByTestId('record-edit-location-add')).toBeDisabled();
  await fireEvent.changeText(
    screen.getByTestId('record-edit-location-new'),
    ' Main display-room cabinet ',
  );
  await press('record-edit-location-add');

  await waitFor(() =>
    expect(
      screen.getByTestId(`record-edit-location-option-${cabinetId}`),
    ).toHaveProp('accessibilityState', {
      checked: true,
    }),
  );
  expect(view.commands).toHaveBeenCalledWith(
    '/v1/locations',
    expect.anything(),
    {
      body: { label: 'Main display-room cabinet' },
    },
  );
  expect(screen.getByTestId('record-edit-location-new')).toHaveProp(
    'value',
    '',
  );
});

it('should explain a location that could not be added', async () => {
  const server = recordServer(collectionRecord);
  const view = await renderEditor(server);
  view.commands.mockRejectedValueOnce(new Error('offline'));

  await fireEvent.changeText(
    screen.getByTestId('record-edit-location-new'),
    'Study',
  );
  await press('record-edit-location-add');

  expect(
    await screen.findByTestId('record-edit-location-new-error'),
  ).toHaveTextContent('Something went wrong.');
});

it('should explain a record that could not be read and read it again', async () => {
  const readRecord = jest
    .fn<() => Promise<unknown>>()
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValue(collectionRecord);
  await renderMobile(<RecordEditContainer recordId={collectionRecord.id} />, {
    get: async (path) =>
      path === `/v1/records/${collectionRecord.id}`
        ? readRecord()
        : path === '/v1/locations'
          ? []
          : { items: [], nextCursor: null },
  });

  await fireEvent.press(await screen.findByRole('button', { name: 'Retry' }));

  expect(await screen.findByTestId('record-edit')).toBeTruthy();
});

it('should label every field in Traditional Chinese', async () => {
  await renderEditor(
    recordServer(filledRecord),
    undefined,
    savedLanguage('zh-Hant'),
  );

  expect(screen.getByText('編輯藏品資料')).toBeTruthy();
  expect(screen.getByLabelText('購入金額')).toBeTruthy();
  expect(screen.getByLabelText('一般位置')).toBeTruthy();
  expect(screen.getByText('這是過往的交易紀錄，並非估價。')).toBeTruthy();
});

it('should link a receipt photo and ignore a tag the item already has', async () => {
  const server = recordServer(
    advanced(filledRecord, {
      acquisition: { ...filledRecord.acquisition, receiptAssetIds: [] },
    }),
  );
  await renderEditor(server);
  await screen.findByText('receipt.jpg');

  await type('tags', ' bowl ');
  await press('record-edit-tag-add');
  await press(`record-edit-receipt-${receiptId}`);
  await press('record-edit-save');

  await waitFor(() => expect(server.bodies).toHaveLength(1));
  expect(server.bodies[0].fields).toEqual({
    acquisition: { ...filledRecord.acquisition, receiptAssetIds: [receiptId] },
  });
});

it('should still offer “Not set” when the location list cannot be read', async () => {
  await renderMobile(<RecordEditContainer recordId={collectionRecord.id} />, {
    get: async (path) => {
      if (path === '/v1/locations') {
        throw new Error('offline');
      }

      return path === `/v1/records/${collectionRecord.id}`
        ? collectionRecord
        : { items: [], nextCursor: null };
    },
  });

  expect(await screen.findByTestId('record-edit-location-none')).toBeTruthy();
  expect(
    screen.queryByTestId(`record-edit-location-option-${cabinetId}`),
  ).toBeNull();
});
