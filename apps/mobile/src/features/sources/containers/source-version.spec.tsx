import { beforeEach, expect, it, jest } from '@jest/globals';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import { useLocalSearchParams } from 'expo-router';
import { Linking } from 'react-native';

import SourceDetailRoute from '../../../app/(private)/sources/[sourceId]';
import { renderMobile } from '../../../mobile.spec.fixtures';

import { assetId, detail, populatedDetail } from './source.spec.fixtures';

jest.mock('../../../providers/AuthProvider', () => ({ useAuth: jest.fn() }));
jest.mock('expo-router', () => ({
  useRouter: jest.fn(),
  useLocalSearchParams: jest.fn(() => ({
    sourceId: '00000000-0000-4000-8000-000000000050',
    versionId: '00000000-0000-4000-8000-000000000051',
    pageId: '00000000-0000-4000-8000-000000000052',
  })),
}));
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
}));

const privateOrigin = 'https://internal.example:8080';
const pdfRetryReadCount = 3;
const historicalRead =
  '/v1/sources/00000000-0000-4000-8000-000000000050?limit=20&versionId=00000000-0000-4000-8000-000000000051&pageId=00000000-0000-4000-8000-000000000052';

beforeEach(() => {
  jest.mocked(useLocalSearchParams).mockReturnValue({
    sourceId: '00000000-0000-4000-8000-000000000050',
    versionId: '00000000-0000-4000-8000-000000000051',
    pageId: '00000000-0000-4000-8000-000000000052',
  });
});

it('should request the cited historical version without falling back to the current source', async () => {
  const readFailure = new Error(
    `Historical page unavailable at ${privateOrigin}`,
  );
  const view = await renderMobile(<SourceDetailRoute />, {
    get: async () => {
      throw readFailure;
    },
  });
  await waitFor(() => {
    for (const alert of screen.getAllByRole('alert')) {
      expect(alert).toHaveTextContent(/\S/);
    }
  });
  expect(screen.queryAllByText(readFailure.message, { exact: false })).toEqual(
    [],
  );
  expect(screen.queryAllByText(privateOrigin, { exact: false })).toEqual([]);
  expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled();
  expect(view.reads.mock.calls.map(([path]) => path)).toEqual([historicalRead]);
  expect([view.commands.mock.calls, view.patches.mock.calls]).toEqual([[], []]);
  await fireEvent.press(screen.getByRole('button', { name: 'Retry' }));
  await waitFor(() =>
    expect(view.reads.mock.calls.map(([path]) => path)).toEqual([
      historicalRead,
      historicalRead,
    ]),
  );
  expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled();
  expect([view.commands.mock.calls, view.patches.mock.calls]).toEqual([[], []]);
});

it('should refresh the signed original PDF URL before opening it', async () => {
  const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
  const view = await renderMobile(<SourceDetailRoute />, {
    get: async () => detail,
  });
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Open original PDF 1' }),
    ).toBeTruthy(),
  );
  view.reads.mockResolvedValueOnce({
    ...detail,
    reads: [
      {
        assetOrDerivativeId: assetId,
        url: 'https://storage.example/fresh.pdf',
      },
    ],
  });
  await fireEvent.press(
    screen.getByRole('button', { name: 'Open original PDF 1' }),
  );
  await waitFor(() =>
    expect(open).toHaveBeenCalledWith('https://storage.example/fresh.pdf'),
  );
  expect(open).toHaveBeenCalledTimes(1);
  expect(view.reads).toHaveBeenCalledTimes(2);
});

it('should show a failed PDF refresh without opening an expired URL and allow a fresh retry', async () => {
  const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
  const view = await renderMobile(<SourceDetailRoute />, {
    get: async () => detail,
  });
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Open original PDF 1' }),
    ).toBeTruthy(),
  );
  const refreshFailure = new Error(
    `Signed URL refresh failed at ${privateOrigin}`,
  );
  expect(view.reads.mock.calls.map(([path]) => path)).toEqual([historicalRead]);
  view.reads.mockRejectedValueOnce(refreshFailure);

  await fireEvent.press(
    screen.getByRole('button', { name: 'Open original PDF 1' }),
  );
  await waitFor(() => {
    for (const alert of screen.getAllByRole('alert')) {
      expect(alert).toHaveTextContent(/\S/);
    }
  });
  expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled();
  expect(view.reads.mock.calls.map(([path]) => path)).toEqual([
    historicalRead,
    historicalRead,
  ]);
  expect([view.commands.mock.calls, view.patches.mock.calls]).toEqual([[], []]);
  expect(open).not.toHaveBeenCalled();
  expect(
    screen.queryAllByText(refreshFailure.message, { exact: false }),
  ).toEqual([]);
  expect(screen.queryAllByText(privateOrigin, { exact: false })).toEqual([]);
  await fireEvent.press(screen.getByRole('button', { name: 'Retry' }));
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Open original PDF 1' }),
    ).toBeTruthy(),
  );
  expect(view.reads).toHaveBeenCalledTimes(pdfRetryReadCount);
  await fireEvent.press(
    screen.getByRole('button', { name: 'Open original PDF 1' }),
  );
  await waitFor(() =>
    expect(open).toHaveBeenCalledWith('https://storage.example/expired.pdf'),
  );
  expect(open).toHaveBeenCalledTimes(1);
  expect(view.reads.mock.calls.map(([path]) => path)).toEqual([
    historicalRead,
    historicalRead,
    historicalRead,
    historicalRead,
  ]);
  expect([view.commands.mock.calls, view.patches.mock.calls]).toEqual([[], []]);
  expect(screen.queryByRole('alert')).toBeNull();
});

it('should require review when the refreshed PDF has no signed read', async () => {
  const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
  const view = await renderMobile(<SourceDetailRoute />, {
    get: async () => detail,
  });
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Open original PDF 1' }),
    ).toBeTruthy(),
  );
  view.reads.mockResolvedValueOnce({ ...detail, reads: [] });

  await fireEvent.press(
    screen.getByRole('button', { name: 'Open original PDF 1' }),
  );
  await waitFor(() =>
    expect(screen.getByRole('alert')).toHaveTextContent('Source needs review'),
  );
  expect(open).not.toHaveBeenCalled();
});

it('should present source pages and reference images and navigate paginated evidence', async () => {
  jest.mocked(useLocalSearchParams).mockReturnValue({ sourceId: 'catalog' });
  const view = await renderMobile(<SourceDetailRoute />, {
    get: async () => populatedDetail,
  });
  await waitFor(() =>
    expect(screen.getByText('Printed catalog prose')).toBeTruthy(),
  );
  expect(screen.getByText('Jane Collector')).toBeTruthy();
  expect(screen.getByText(/Second edition/)).toBeTruthy();
  expect(screen.getByLabelText('Historical catalog, xii')).toBeTruthy();
  expect(screen.getByLabelText('Historical catalog, 2')).toBeTruthy();
  expect(screen.getByText(/90° · Select region/)).toBeTruthy();
  expect(screen.getByText(/0° · Full image/)).toBeTruthy();
  expect(screen.getByLabelText('Printed vase caption')).toBeTruthy();
  expect(screen.getByLabelText('Original image')).toBeTruthy();
  expect(screen.getByText('花瓶圖例')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'View 00000000' }));
  expect(view.router.push).toHaveBeenCalledWith(
    '/knowledge/00000000-0000-4000-8000-000000000061',
  );
  await fireEvent.press(screen.getByRole('button', { name: 'More' }));
  await waitFor(() =>
    expect(
      view.reads.mock.calls.some(([path]) =>
        path.includes('pageCursor=page-next'),
      ),
    ).toBe(true),
  );
});

it('should show failed source processing instead of implying empty pages are still processing', async () => {
  await renderMobile(<SourceDetailRoute />, {
    get: async () => ({
      ...detail,
      version: { ...detail.version, status: 'failed' },
      knowledgeDraftIds: ['00000000-0000-4000-8000-000000000061'],
    }),
  });
  await waitFor(() =>
    expect(screen.getByText('Something went wrong.')).toBeTruthy(),
  );
  expect(screen.queryByText('Processing')).toBeNull();
});
