import { beforeEach, expect, it, jest } from '@jest/globals';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import { useLocalSearchParams } from 'expo-router';
import { Linking } from 'react-native';

import SourceDetailRoute from '../../app/(private)/sources/[sourceId]';
import { renderMobile } from '../../mobile.spec.fixtures';

import { assetId, detail, populatedDetail } from './source.spec.fixtures';

jest.mock('../../auth', () => ({ useAuth: jest.fn() }));
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

beforeEach(() => {
  jest.mocked(useLocalSearchParams).mockReturnValue({
    sourceId: '00000000-0000-4000-8000-000000000050',
    versionId: '00000000-0000-4000-8000-000000000051',
    pageId: '00000000-0000-4000-8000-000000000052',
  });
});

it('should request the cited historical version without falling back to the current source', async () => {
  const view = await renderMobile(<SourceDetailRoute />, {
    get: async () => {
      throw new Error('Historical page unavailable');
    },
  });
  await waitFor(() =>
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Historical page unavailable',
    ),
  );
  expect(view.reads.mock.calls.map(([path]) => path)).toEqual([
    '/v1/sources/00000000-0000-4000-8000-000000000050?limit=20&versionId=00000000-0000-4000-8000-000000000051&pageId=00000000-0000-4000-8000-000000000052',
  ]);
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
  view.reads.mockRejectedValueOnce(new Error('Signed URL refresh failed'));

  await fireEvent.press(
    screen.getByRole('button', { name: 'Open original PDF 1' }),
  );
  await waitFor(() =>
    expect(screen.getAllByRole('alert')[0]).toHaveTextContent(
      'Signed URL refresh failed',
    ),
  );
  expect(open).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: 'Retry' }));
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Open original PDF 1' }),
    ).toBeTruthy(),
  );
  await fireEvent.press(
    screen.getByRole('button', { name: 'Open original PDF 1' }),
  );
  await waitFor(() =>
    expect(open).toHaveBeenCalledWith('https://storage.example/expired.pdf'),
  );
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
