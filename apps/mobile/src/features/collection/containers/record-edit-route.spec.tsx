import { expect, it, jest } from '@jest/globals';
import { act, waitFor } from '@testing-library/react-native';

import { useLocalSearchParams, useNavigation } from 'expo-router';

import { Alert } from 'react-native';

import RecordEditRoute from '../../../app/(private)/collection/[recordId]/edit';
import { usePreventRemove } from 'expo-router/react-navigation';

import { filledRecord } from '../record-edit.spec.fixtures';

import {
  press,
  recordServer,
  renderEditor,
  type,
} from './record-edit.spec.fixtures';

type LeaveAction = { type: string };
type LeaveCallback = (options: { data: { action: LeaveAction } }) => void;

const screenOptions: Array<{ gestureEnabled?: boolean }> = [];

jest.mock('../../../providers/AuthProvider', () => ({ useAuth: jest.fn() }));
jest.mock('expo-router', () => ({
  useRouter: jest.fn(),
  useLocalSearchParams: jest.fn(),
  useNavigation: jest.fn(),
  Stack: {
    Screen: ({ options }: { options: { gestureEnabled?: boolean } }) => {
      screenOptions.push(options);

      return null;
    },
  },
}));
jest.mock('expo-router/react-navigation', () => ({
  usePreventRemove: jest.fn(),
}));
jest.mock('expo-crypto', () => ({
  randomUUID:
    jest.requireActual<typeof import('node:crypto')>('node:crypto').randomUUID,
}));

/**
 * renders the edit route with a navigation that reports leave attempts as the
 * native stack does: only while the screen asks to prevent its removal
 * @returns the harness, the navigation's dispatch, and a way to try leaving
 */
async function renderRoute(): Promise<{
  view: Awaited<ReturnType<typeof renderEditor>>;
  dispatch: jest.Mock;
  attempt: () => { prevented: boolean; action: LeaveAction };
  leave: () => Promise<{ prevented: boolean; action: LeaveAction }>;
}> {
  const dispatch = jest.fn();
  let prevent = false;
  let callback: LeaveCallback | undefined;
  screenOptions.length = 0;
  jest
    .mocked(useLocalSearchParams)
    .mockReturnValue({ recordId: filledRecord.id });
  jest.mocked(useNavigation).mockReturnValue({ dispatch });
  jest.mocked(usePreventRemove).mockImplementation((value, handler) => {
    prevent = value;
    callback = handler;
  });
  const view = await renderEditor(
    recordServer(filledRecord),
    <RecordEditRoute />,
  );
  const attempt = (): { prevented: boolean; action: LeaveAction } => {
    const action = { type: 'GO_BACK' };
    const prevented = prevent;
    if (prevented) {
      callback?.({ data: { action } });
    }

    return { prevented, action };
  };
  const leave = async (): Promise<{
    prevented: boolean;
    action: LeaveAction;
  }> => {
    let result = { prevented: false, action: { type: '' } };
    await act(async () => {
      result = attempt();
    });

    return result;
  };

  return { view, dispatch, attempt, leave };
}

/**
 * reads whether the iOS back gesture is currently allowed
 * @returns the latest gesture option the route set
 */
function gestureEnabled(): boolean | undefined {
  return screenOptions.at(-1)?.gestureEnabled;
}

it('should leave without asking while nothing is unsaved', async () => {
  const alert = jest.spyOn(Alert, 'alert');
  const { leave } = await renderRoute();

  expect((await leave()).prevented).toBe(false);
  expect(gestureEnabled()).toBe(true);
  expect(alert).not.toHaveBeenCalled();
});

it('should ask before discarding unsaved changes and leave only when discarded', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  const { dispatch, leave } = await renderRoute();
  await type('name', 'My bowl');

  const event = await leave();

  expect(event.prevented).toBe(true);
  // an iOS swipe-back cannot be asked about, so it is off
  expect(gestureEnabled()).toBe(false);
  expect(alert).toHaveBeenCalledWith(
    'Discard your changes?',
    'Your edits to this item have not been saved.',
    expect.any(Array),
  );
  const buttons = alert.mock.calls[0][2]!;
  expect(buttons.map((button) => button.text)).toEqual([
    'Keep editing',
    'Discard',
  ]);
  expect(dispatch).not.toHaveBeenCalled();
  buttons[1].onPress?.();
  expect(dispatch).toHaveBeenCalledWith(event.action);
});

it('should stand down once the changes are saved', async () => {
  const alert = jest.spyOn(Alert, 'alert');
  const { view, leave } = await renderRoute();
  await type('name', 'My bowl');
  await press('record-edit-save');

  await waitFor(() => expect(view.router.back).toHaveBeenCalled());
  expect((await leave()).prevented).toBe(false);
  expect(gestureEnabled()).toBe(true);
  expect(alert).not.toHaveBeenCalled();
});

it('should leave right after a save without asking, before the screen re-renders clean', async () => {
  const alert = jest.spyOn(Alert, 'alert');
  const { view, dispatch, attempt } = await renderRoute();
  await type('name', 'My bowl');
  const leaves: boolean[] = [];
  // the save reports clean and goes back within one event, before React re-renders
  jest
    .mocked(view.router.back)
    .mockImplementation(() => leaves.push(attempt().prevented));
  await press('record-edit-save');

  await waitFor(() =>
    expect(dispatch).toHaveBeenCalledWith({ type: 'GO_BACK' }),
  );
  expect(leaves).toEqual([true]);
  expect(alert).not.toHaveBeenCalled();
});
