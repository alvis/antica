import { expect, it, jest } from '@jest/globals';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';

import { Linking } from 'react-native';

import ResearchDetailRoute from '../../app/(private)/research/[researchId]';
import { renderMobile } from '../../mobile.spec.fixtures';

import { detail, sourceId, richDetail } from './citation.spec.fixtures';

jest.mock('../../auth', () => ({ useAuth: jest.fn() }));
jest.mock('expo-router', () => ({
  useRouter: jest.fn(),
  useLocalSearchParams: () => ({
    researchId: '00000000-0000-4000-8000-000000000030',
  }),
}));
jest.mock('expo-crypto', () => ({
  randomUUID:
    jest.requireActual<typeof import('node:crypto')>('node:crypto').randomUUID,
}));

it('should show research warnings and saved notes and open sources and web citations', async () => {
  const url = 'https://museum.example/research#source';
  const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
  const view = await renderMobile(<ResearchDetailRoute />, {
    get: async () => richDetail,
  });
  await waitFor(() =>
    expect(screen.getByText('Saved comparison')).toBeTruthy(),
  );
  expect(screen.getByText('Collector conclusion')).toBeTruthy();
  expect(screen.getByText('Check the attribution')).toBeTruthy();
  expect(screen.getByText('Source needs review')).toBeTruthy();
  await fireEvent.press(
    screen.getByRole('button', { name: 'View source 20000000' }),
  );
  expect(view.router.push).toHaveBeenCalledWith(`/sources/${sourceId}`);
  await fireEvent.press(
    screen.getByRole('button', { name: 'View source 10000000' }),
  );
  expect(open).toHaveBeenCalledWith(url);
});

it('should poll research without a draft until a note becomes available', async () => {
  let reads = 0;
  await renderMobile(<ResearchDetailRoute />, {
    get: async () =>
      ++reads === 1
        ? { ...detail, state: { kind: 'queued' }, sourceIds: [], draft: null }
        : detail,
  });
  await waitFor(() =>
    expect(screen.getByText('Nothing here yet.')).toBeTruthy(),
  );
  expect(screen.queryByRole('button', { name: 'Save note' })).toBeNull();
  await waitFor(
    () =>
      expect(screen.getByRole('button', { name: 'Save note' })).toBeTruthy(),
    { timeout: 10000 },
  );
});

it('should save unchanged draft prose and prevent duplicate submission while pending', async () => {
  const pending = Promise.withResolvers<unknown>();
  const view = await renderMobile(<ResearchDetailRoute />, {
    get: async () => detail,
    post: async () => pending.promise,
  });
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Save note' })).toBeTruthy(),
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Save note' }));
  expect(screen.getByRole('button', { name: 'Save note' })).toBeDisabled();
  await fireEvent.press(screen.getByRole('button', { name: 'Save note' }));
  expect(view.commands).toHaveBeenCalledTimes(1);
  expect(view.commands.mock.calls[0]?.[2].body).toMatchObject({
    titleZhHant: detail.draft!.titleZhHant,
    paragraphs: detail.draft!.paragraphs,
  });
  await act(async () => pending.resolve({}));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Save note' })).toBeEnabled(),
  );
});
