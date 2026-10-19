import { expect, it, jest } from '@jest/globals';
import { screen, waitFor, within } from '@testing-library/react-native';

import { recordEditNoticeQuery } from '../api/record-edit-notice';
import { advanced, filledRecord, studyId } from '../record-edit.spec.fixtures';

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

/** a first save, its single re-send, and one more save */
const threeAttempts = 3;

/**
 * lists the revisions a run of saves is expected to send, one per attempt
 * @param opened revision the editor opened at
 * @param attempts number of PATCH attempts
 * @returns consecutive revisions starting at the opened one
 */
function revisionsFrom(opened: number, attempts: number): number[] {
  return Array.from({ length: attempts }, (_, index) => opened + index);
}

/**
 * reads the text of a field's conflict card
 * @param field kebab-case field name
 * @returns every text in the card
 */
function conflictText(field: string): string {
  return within(screen.getByTestId(`record-edit-conflict-${field}`))
    .getAllByText(/.+/)
    .map((node) => String(node.props.children))
    .join(' | ');
}

it('should re-send once by itself when only unedited fields changed in the background (I21)', async () => {
  const server = recordServer(filledRecord);
  const view = await renderEditor(server);
  await type('name', 'My bowl');
  await type('location-detail', 'Top shelf');
  // media processing raises the revision and another field moves without a conflict
  server.change({
    evidenceVersion: 2,
    mediaIds: [...filledRecord.mediaIds],
    description: 'Server note',
  });
  await press('record-edit-save');

  await waitFor(() => expect(view.router.back).toHaveBeenCalledTimes(1));
  expect(server.bodies.map((body) => body.expectedRevision)).toEqual(
    revisionsFrom(filledRecord.recordRevision, 2),
  );
  expect(server.bodies[1].fields).toEqual(server.bodies[0].fields);
  expect(server.bodies[1].fields).toEqual({
    name: 'My bowl',
    location: {
      locationId: filledRecord.location.locationId,
      detail: 'Top shelf',
    },
  });
  // the background change survives the save
  expect(server.record).toMatchObject({
    name: 'My bowl',
    description: 'Server note',
    recordRevision: 6,
  });
  expect(
    view.client.getQueryData(recordEditNoticeQuery(filledRecord.id).queryKey),
  ).toBe('refreshed');
  expect(screen.queryByTestId('record-edit-conflict')).toBeNull();
});

it('should show only the changed fields that also changed on the server, side by side, and save the choices', async () => {
  const server = recordServer(filledRecord);
  const view = await renderEditor(server);
  await type('name', 'My bowl');
  await type('height', '9');
  await type('tags', 'mine');
  await press('record-edit-tag-add');
  server.change({
    name: 'Server bowl',
    dimensions: {
      ...filledRecord.dimensions,
      height: { value: 8.6, unit: 'cm' },
    },
    description: 'Server note',
  });
  await press('record-edit-save');

  expect(await screen.findByTestId('record-edit-conflict')).toBeTruthy();
  expect(screen.queryByTestId('record-edit-conflict-tags')).toBeNull();
  expect(conflictText('name')).toBe(
    'Name | Your edit | My bowl | Current value | Server bowl | Keep mine | Use current',
  );
  expect(conflictText('height')).toContain(
    'Your edit | 9 cm | Current value | 8.6 cm',
  );
  expect(screen.getByTestId('record-edit-conflict-save')).toBeDisabled();
  expect(screen.queryByTestId('record-edit-save')).toBeNull();
  // nothing is written until the collector chose
  expect(server.bodies).toHaveLength(1);

  await press('record-edit-conflict-keep-mine-name');
  expect(screen.getByTestId('record-edit-conflict-save')).toBeDisabled();
  await press('record-edit-conflict-use-current-height');
  expect(screen.getByTestId('record-edit-conflict-keep-mine-name')).toHaveProp(
    'accessibilityState',
    { checked: true },
  );
  await press('record-edit-conflict-save');

  await waitFor(() => expect(view.router.back).toHaveBeenCalledTimes(1));
  expect(server.bodies[1]).toEqual({
    expectedRevision: 5,
    fields: { name: 'My bowl', tags: ['bowl', 'porcelain', 'mine'] },
  });
  expect(server.record).toMatchObject({
    name: 'My bowl',
    description: 'Server note',
    dimensions: { height: { value: 8.6, unit: 'cm' } },
  });
});

it('should repeat the conflict view when the field changes again before the choices are saved', async () => {
  const server = recordServer(filledRecord);
  const view = await renderEditor(server);
  await type('name', 'My bowl');
  server.change({ name: 'Server bowl' });
  await press('record-edit-save');
  await press('record-edit-conflict-keep-mine-name');
  server.beforePatch = (attempt) => {
    if (attempt === 2) {
      server.change({ name: 'Second server bowl' });
    }
  };
  await press('record-edit-conflict-save');

  await waitFor(() =>
    expect(conflictText('name')).toContain(
      'Current value | Second server bowl',
    ),
  );
  expect(screen.getByTestId('record-edit-conflict-save')).toBeDisabled();
  await press('record-edit-conflict-keep-mine-name');
  await press('record-edit-conflict-save');

  await waitFor(() => expect(view.router.back).toHaveBeenCalledTimes(1));
  expect(server.bodies.map((body) => body.expectedRevision)).toEqual(
    revisionsFrom(filledRecord.recordRevision, threeAttempts),
  );
  expect(server.record.name).toBe('My bowl');
});

it('should stop after one automatic re-send when the record keeps changing, and save when asked', async () => {
  const server = recordServer(filledRecord);
  const view = await renderEditor(server);
  await type('name', 'My bowl');
  server.beforePatch = (attempt) => {
    if (attempt <= 2) {
      server.change({ evidenceVersion: attempt + 1 });
    }
  };
  await press('record-edit-save');

  expect(
    await screen.findByTestId('record-edit-changed-again'),
  ).toHaveTextContent(
    'This item changed again while saving. Its latest values are shown; check them and save again.',
  );
  expect(server.bodies).toHaveLength(2);
  expect(screen.getByTestId('record-edit-field-name')).toHaveProp(
    'value',
    'My bowl',
  );
  await press('record-edit-save');

  await waitFor(() => expect(view.router.back).toHaveBeenCalledTimes(1));
  expect(server.bodies.map((body) => body.expectedRevision)).toEqual(
    revisionsFrom(filledRecord.recordRevision, threeAttempts),
  );
});

it('should save nothing when the collector takes every current value', async () => {
  const server = recordServer(filledRecord);
  const view = await renderEditor(server);
  await press(`record-edit-location-option-${studyId}`);
  server.change({ location: { locationId: null, detail: 'Moved' } });
  await press('record-edit-save');
  await press('record-edit-conflict-use-current-location-id');
  await press('record-edit-conflict-save');

  await waitFor(() => expect(view.router.back).toHaveBeenCalledTimes(1));
  expect(server.bodies).toHaveLength(1);
  expect(server.record.location).toEqual({ locationId: null, detail: 'Moved' });
});

it('should leave the editor and the record unchanged when an analysis result arrives or is viewed (PT-14)', async () => {
  const server = recordServer(filledRecord);
  const view = await renderEditor(server);
  await type('name', 'My bowl');
  const analysed = advanced(filledRecord, {
    latestRunId: '00000000-0000-4000-8000-000000000799',
    analysisFreshness: 'current',
  });
  // the record screen refreshes the record while the analysis result is viewed
  view.client.setQueryData(['record', filledRecord.id], analysed);
  server.record = analysed;
  await view.client.invalidateQueries({
    queryKey: ['record', filledRecord.id],
  });

  expect(screen.getByTestId('record-edit-field-name')).toHaveProp(
    'value',
    'My bowl',
  );
  expect(screen.getByTestId('record-edit-field-height')).toHaveProp(
    'value',
    '8.4',
  );
  expect(screen.getByTestId('record-edit-field-location-detail')).toHaveProp(
    'value',
    'Second shelf',
  );
  expect(view.patches).not.toHaveBeenCalled();
  expect(server.record).toMatchObject({
    name: filledRecord.name,
    materialIds: filledRecord.materialIds,
    period: filledRecord.period,
    tags: filledRecord.tags,
  });
});

it('should never overwrite a field changed on the server by a stale manual edit (PT-14)', async () => {
  const server = recordServer(filledRecord);
  const view = await renderEditor(server);
  await type('period', 'Yongzheng');
  server.change({ period: { label: 'Qianlong', status: 'unconfirmed' } });
  await press('record-edit-save');

  expect(await screen.findByTestId('record-edit-conflict-period')).toBeTruthy();
  expect(conflictText('period')).toContain(
    'Your edit | Yongzheng (1662–1722) · collector’s claim | Current value | Qianlong · unconfirmed',
  );
  expect(server.bodies).toHaveLength(1);
  expect(server.record.period).toEqual({
    label: 'Qianlong',
    status: 'unconfirmed',
  });
  expect(view.router.back).not.toHaveBeenCalled();
});
