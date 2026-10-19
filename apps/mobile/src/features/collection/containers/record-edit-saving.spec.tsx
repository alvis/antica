import { expect, it, jest } from '@jest/globals';
import { act, screen, waitFor, within } from '@testing-library/react-native';

import { ApiError } from '@antica/client';

import { filledRecord } from '../record-edit.spec.fixtures';

import {
  press,
  recordServer,
  renderEditor,
  type,
} from './record-edit.spec.fixtures';

import type { MobileHarness } from '../../../mobile.spec.fixtures';

jest.mock('../../../providers/AuthProvider', () => ({ useAuth: jest.fn() }));
jest.mock('expo-router', () => ({
  useRouter: jest.fn(),
  useLocalSearchParams: jest.fn(),
}));
jest.mock('expo-crypto', () => ({
  randomUUID:
    jest.requireActual<typeof import('node:crypto')>('node:crypto').randomUUID,
}));

const recordPath = `/v1/records/${filledRecord.id}`;

/**
 * holds the next PATCH until released, so the test can act while the save runs
 * @param view editor harness
 * @returns releases the held PATCH
 */
function holdNextPatch(view: MobileHarness): () => void {
  const respond = view.patches.getMockImplementation()!;
  let release: () => void = () => undefined;
  const answered = new Promise<void>((resolve) => {
    release = resolve;
  });
  view.patches.mockImplementationOnce(async (...args) => {
    await answered;

    return respond(...args);
  });

  return () => release();
}

/**
 * counts the reads of the edited record so far
 * @param view editor harness
 * @returns how many times the record was read
 */
function recordReads(view: MobileHarness): number {
  return view.reads.mock.calls.filter(([path]) => path === recordPath).length;
}

/**
 * reads the current value shown in a field's conflict card
 * @param field kebab-case field name
 * @returns every text in the card, joined
 */
function conflictText(field: string): string {
  return within(screen.getByTestId(`record-edit-conflict-${field}`))
    .getAllByText(/.+/)
    .map((node) => String(node.props.children))
    .join(' | ');
}

it('should close the conflict view and show the save running until the server answers', async () => {
  const server = recordServer(filledRecord);
  const view = await renderEditor(server);
  await type('name', 'My bowl');
  server.change({ name: 'Server bowl' });
  await press('record-edit-save');
  await press('record-edit-conflict-keep-mine-name');
  const release = holdNextPatch(view);
  await press('record-edit-conflict-save');

  expect(screen.queryByTestId('record-edit-conflict')).toBeNull();
  expect(screen.getByTestId('record-edit-save')).toHaveTextContent('Saving…');
  expect(screen.getByTestId('record-edit-save')).toBeDisabled();
  release();
  await waitFor(() => expect(view.router.back).toHaveBeenCalledTimes(1));
});

it('should keep the edit and explain when the latest record cannot be read after a conflict', async () => {
  const server = recordServer(filledRecord);
  const view = await renderEditor(server);
  await type('name', 'My bowl');
  server.change({ name: 'Server bowl' });
  view.reads.mockRejectedValueOnce(new Error('offline'));
  await press('record-edit-save');

  expect(await screen.findByTestId('record-edit-error')).toHaveTextContent(
    'Something went wrong.',
  );
  expect(screen.getByTestId('record-edit-field-name')).toHaveProp(
    'value',
    'My bowl',
  );
  expect(screen.queryByTestId('record-edit-conflict')).toBeNull();
  expect(view.router.back).not.toHaveBeenCalled();
});

it('should keep the form read-only while a save runs, so nothing typed meanwhile is lost', async () => {
  const server = recordServer(filledRecord);
  const view = await renderEditor(server);
  await type('name', 'My bowl');
  const release = holdNextPatch(view);
  await press('record-edit-save');

  const fields = screen.getByTestId('record-edit-fields');
  expect(fields).toHaveProp('pointerEvents', 'none');
  // the wrapper stays a real view, so locking the form never re-parents it on Android
  expect(fields).toHaveProp('collapsable', false);
  await type('name', 'Typed while saving');
  expect(screen.getByTestId('record-edit-field-name')).toHaveProp(
    'value',
    'My bowl',
  );
  release();

  await waitFor(() => expect(view.router.back).toHaveBeenCalledTimes(1));
  expect(server.record.name).toBe('My bowl');
});

it('should read the record afresh after a conflict instead of joining a read already under way', async () => {
  const server = recordServer(filledRecord);
  const view = await renderEditor(server);
  await type('name', 'My bowl');
  const respond = view.reads.getMockImplementation()!;
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  // a refresh that started before the other writer saved, still on its way back
  view.reads.mockImplementationOnce(async () => {
    await held;

    return filledRecord;
  });
  await act(async () => {
    void view.client.refetchQueries({ queryKey: ['record', filledRecord.id] });
  });
  view.reads.mockImplementation(respond);
  server.change({ name: 'Server bowl' });
  await press('record-edit-save');

  expect(await screen.findByTestId('record-edit-conflict-name')).toBeTruthy();
  expect(conflictText('name')).toContain('Current value | Server bowl');
  release();
});

it('should read once more when the record read after a conflict is no newer than the edit', async () => {
  const server = recordServer(filledRecord);
  const view = await renderEditor(server);
  await type('name', 'My bowl');
  server.change({ name: 'Server bowl' });
  const respond = view.reads.getMockImplementation()!;
  let stale = 1;
  // a cache or replica that has not caught up answers the first read
  view.reads.mockImplementation(async (path, ...rest) =>
    path === recordPath && stale-- > 0 ? filledRecord : respond(path, ...rest),
  );
  const before = recordReads(view);
  await press('record-edit-save');

  expect(await screen.findByTestId('record-edit-conflict-name')).toBeTruthy();
  expect(conflictText('name')).toContain('Current value | Server bowl');
  expect(recordReads(view) - before).toBe(2);
  expect(server.bodies).toHaveLength(1);
});

it('should close as saved when a save whose reply was lost had already landed', async () => {
  const server = recordServer(filledRecord);
  const view = await renderEditor(server);
  await type('name', 'My bowl');
  const respond = view.patches.getMockImplementation()!;
  // the server applies the save, but its reply never arrives
  view.patches.mockImplementationOnce(async (...args) => {
    await respond(...args);
    throw new ApiError({
      status: 0,
      code: 'NETWORK_ERROR',
      message: 'Network request failed',
      retryable: true,
    });
  });
  await press('record-edit-save');
  expect(await screen.findByTestId('record-edit-error')).toBeTruthy();

  await press('record-edit-save');

  await waitFor(() => expect(view.router.back).toHaveBeenCalledTimes(1));
  expect(server.keys[1]).toBe(server.keys[0]);
  expect(server.record).toMatchObject({
    name: 'My bowl',
    recordRevision: filledRecord.recordRevision + 1,
  });
  expect(screen.queryByTestId('record-edit-conflict')).toBeNull();
});

it('should drop a field the server already holds as typed and re-send only the rest', async () => {
  const server = recordServer(filledRecord);
  const view = await renderEditor(server);
  await type('name', 'My bowl');
  await type('location-detail', 'Top shelf');
  // another device saved the same name meanwhile
  server.change({ name: 'My bowl' });
  await press('record-edit-save');

  await waitFor(() => expect(view.router.back).toHaveBeenCalledTimes(1));
  expect(server.bodies[1]).toEqual({
    expectedRevision: filledRecord.recordRevision + 1,
    fields: {
      location: {
        locationId: filledRecord.location.locationId,
        detail: 'Top shelf',
      },
    },
  });
  expect(screen.queryByTestId('record-edit-conflict')).toBeNull();
});
