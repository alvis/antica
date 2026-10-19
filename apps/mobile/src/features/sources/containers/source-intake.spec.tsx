import { expect, it, jest } from '@jest/globals';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import { File } from 'expo-file-system';
import { launchImageLibraryAsync } from 'expo-image-picker';

import { uploadMedia } from '../../../adapters/media-upload';
import NewSourceRoute from '../../../app/(private)/sources/new';

import { renderMobile } from '../../../mobile.spec.fixtures';

jest.mock('../../../providers/AuthProvider', () => ({ useAuth: jest.fn() }));
jest.mock('expo-router', () => ({ useRouter: jest.fn() }));
jest.mock('expo-crypto', () => ({
  randomUUID:
    jest.requireActual<typeof import('node:crypto')>('node:crypto').randomUUID,
}));
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
}));
jest.mock('expo-file-system', () => ({
  File: { pickFileAsync: jest.fn(async () => ({ canceled: true })) },
}));
jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: jest.fn(async () => ({
    canceled: true,
    assets: null,
  })),
}));
jest.mock('../../../adapters/media-upload', () => ({
  uploadMedia: jest.fn(async () => '00000000-0000-4000-8000-000000000081'),
}));
jest.mock('expo-image-manipulator', () => ({
  SaveFormat: { JPEG: 'jpeg' },
  manipulateAsync: jest.fn(async () => ({ uri: 'file:///prepared.jpg' })),
}));

const sourceId = '00000000-0000-4000-8000-000000000080';
const firstAssetId = '00000000-0000-4000-8000-000000000081';
const secondAssetId = '00000000-0000-4000-8000-000000000082';
const accepted = { sourceId, sourceVersionId: sourceId, jobId: sourceId };
const pages = {
  canceled: false as const,
  assets: [
    {
      uri: 'file:///one.jpg',
      fileName: 'one.jpg',
      mimeType: 'image/jpeg',
      width: 1000,
      height: 500,
    },
    {
      uri: 'file:///two.jpg',
      fileName: 'two.jpg',
      mimeType: 'image/jpeg',
      width: 800,
      height: 600,
    },
  ],
};

it('should order, rotate and label selected pages in the registered source', async () => {
  jest.mocked(launchImageLibraryAsync).mockResolvedValueOnce(pages);
  const view = await renderMobile(<NewSourceRoute />, {
    post: async () => accepted,
  });
  expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  await fireEvent.press(screen.getByRole('button', { name: 'Photo' }));
  await waitFor(() => expect(screen.getByText('1. one.jpg')).toBeTruthy());
  await fireEvent.press(screen.getAllByRole('button', { name: '↓' })[0]);
  expect(screen.getByText('1. two.jpg')).toBeTruthy();
  await fireEvent.press(
    screen.getAllByRole('button', { name: 'Rotate preview' })[0],
  );
  await fireEvent.changeText(screen.getAllByLabelText('Printed page')[0], 'iv');
  await fireEvent.changeText(
    screen.getByLabelText('Book title'),
    '  Antique catalog  ',
  );
  await fireEvent.changeText(
    screen.getByLabelText('Author'),
    '  Jane Collector  ',
  );
  jest
    .mocked(uploadMedia)
    .mockResolvedValueOnce(secondAssetId)
    .mockResolvedValueOnce(firstAssetId);
  await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() =>
    expect(view.router.replace).toHaveBeenCalledWith(`/sources/${sourceId}`),
  );
  expect(view.commands.mock.calls.at(-1)?.[2].body).toEqual(
    expect.objectContaining({
      mode: 'register',
      registration: expect.objectContaining({
        kind: 'book_pages',
        metadata: expect.objectContaining({
          title: 'Antique catalog',
          authorStatus: 'named',
          contributors: [
            {
              nameAsPrinted: 'Jane Collector',
              role: 'author',
              attribution: 'collector_entered',
            },
          ],
        }),
        assets: [
          {
            assetId: secondAssetId,
            order: 0,
            printedPageLabel: 'iv',
            presentation: { rotationQuarterTurns: 1, crop: null },
          },
          {
            assetId: firstAssetId,
            order: 1,
            printedPageLabel: null,
            presentation: { rotationQuarterTurns: 0, crop: null },
          },
        ],
      }),
    }),
  );
});

it('should register a PDF with an unknown author and no page presentation', async () => {
  const pickSingle = File.pickFileAsync as (options: {
    mimeTypes: string;
  }) => Promise<{
    canceled: boolean;
    result: File | null;
  }>;
  jest.mocked(pickSingle).mockResolvedValueOnce({
    canceled: false,
    result: { uri: 'file:///catalog.pdf', name: 'catalog.pdf' } as File,
  });
  const view = await renderMobile(<NewSourceRoute />, {
    post: async () => accepted,
  });
  await fireEvent.press(screen.getByRole('button', { name: 'PDF' }));
  await waitFor(() => expect(screen.getByText('1. catalog.pdf')).toBeTruthy());
  await fireEvent.press(screen.getByRole('button', { name: 'Unknown author' }));
  await fireEvent.changeText(screen.getByLabelText('Book title'), 'Catalog');
  await fireEvent.changeText(screen.getByLabelText('Edition'), '  Second  ');
  await fireEvent.changeText(screen.getByLabelText('Publisher'), '  Archive  ');
  await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() =>
    expect(view.router.replace).toHaveBeenCalledWith(`/sources/${sourceId}`),
  );
  expect(view.commands.mock.calls.at(-1)?.[2].body).toEqual(
    expect.objectContaining({
      registration: expect.objectContaining({
        kind: 'book_pdf',
        assets: [{ assetId: firstAssetId, order: 0, printedPageLabel: null }],
        metadata: expect.objectContaining({
          authorStatus: 'unknown',
          contributors: [],
          editionStatement: 'Second',
          publisher: 'Archive',
        }),
      }),
    }),
  );
});

it('should preserve selected pages and title when upload fails, then retry', async () => {
  jest
    .mocked(launchImageLibraryAsync)
    .mockResolvedValueOnce({ ...pages, assets: [pages.assets[0]] });
  jest
    .mocked(uploadMedia)
    .mockRejectedValueOnce(new Error('Upload unavailable'));
  const view = await renderMobile(<NewSourceRoute />, {
    post: async () => accepted,
  });
  await fireEvent.press(screen.getByRole('button', { name: 'Photo' }));
  await waitFor(() => expect(screen.getByText('1. one.jpg')).toBeTruthy());
  await fireEvent.changeText(screen.getByLabelText('Book title'), 'Catalog');
  await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() =>
    expect(screen.getByRole('alert')).toHaveTextContent(
      'one.jpg: Upload unavailable',
    ),
  );
  expect(screen.getByLabelText('Book title')).toHaveDisplayValue('Catalog');
  expect(view.commands).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() =>
    expect(view.router.replace).toHaveBeenCalledWith(`/sources/${sourceId}`),
  );
});

it('should keep intake empty after cancelled selections and surface picker errors', async () => {
  const view = await renderMobile(<NewSourceRoute />, {});
  await fireEvent.press(screen.getByRole('button', { name: 'PDF' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Photo' }));
  expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  jest
    .mocked(File.pickFileAsync)
    .mockRejectedValueOnce(new Error('Document picker unavailable'));
  await fireEvent.press(screen.getByRole('button', { name: 'PDF' }));
  await waitFor(() =>
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Document picker unavailable',
    ),
  );
  jest
    .mocked(launchImageLibraryAsync)
    .mockRejectedValueOnce(new Error('Photo picker unavailable'));
  await fireEvent.press(screen.getByRole('button', { name: 'Photo' }));
  await waitFor(() =>
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Photo picker unavailable',
    ),
  );
  expect(view.commands).not.toHaveBeenCalled();
});

it('should save a cropped page and retain intake fields after registration rejection', async () => {
  jest
    .mocked(launchImageLibraryAsync)
    .mockResolvedValueOnce({ ...pages, assets: [pages.assets[0]] });
  const view = await renderMobile(<NewSourceRoute />, {
    post: async () => {
      throw new Error('Registration unavailable');
    },
  });
  await fireEvent.press(screen.getByRole('button', { name: 'Photo' }));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Select region' })).toBeTruthy(),
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Select region' }), {
    nativeEvent: { locationX: 0, locationY: 0 },
  });
  await fireEvent.press(screen.getByRole('button', { name: 'Rotate preview' }));
  await fireEvent.changeText(
    screen.getByLabelText('Book title'),
    'Cropped catalog',
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() =>
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Registration unavailable',
    ),
  );
  expect(screen.getByLabelText('Book title')).toHaveDisplayValue(
    'Cropped catalog',
  );
  expect(view.commands.mock.calls.at(-1)?.[2].body).toEqual(
    expect.objectContaining({
      registration: expect.objectContaining({
        assets: [
          {
            assetId: firstAssetId,
            order: 0,
            printedPageLabel: null,
            presentation: {
              rotationQuarterTurns: 1,
              crop: { kind: 'rect', x: 0, y: 0, width: 0.5, height: 0.5 },
            },
          },
        ],
      }),
    }),
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Full image' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(view.commands).toHaveBeenCalledTimes(2));
  expect(view.commands.mock.calls.at(-1)?.[2].body).toEqual(
    expect.objectContaining({
      registration: expect.objectContaining({
        assets: [
          {
            assetId: firstAssetId,
            order: 0,
            printedPageLabel: null,
            presentation: { rotationQuarterTurns: 1, crop: null },
          },
        ],
      }),
    }),
  );
});

it('should append later page selections and move the new page upward', async () => {
  jest
    .mocked(launchImageLibraryAsync)
    .mockResolvedValueOnce({ ...pages, assets: [pages.assets[0]] })
    .mockResolvedValueOnce({
      ...pages,
      assets: [
        {
          uri: 'file:///later.jpg',
          width: 600,
          height: 400,
        },
      ],
    });
  const view = await renderMobile(<NewSourceRoute />, {
    post: async () => accepted,
  });
  await fireEvent.press(screen.getByRole('button', { name: 'Photo' }));
  await waitFor(() => expect(screen.getByText('1. one.jpg')).toBeTruthy());
  await fireEvent.press(screen.getByRole('button', { name: 'Photo' }));
  await waitFor(() =>
    expect(screen.getAllByLabelText('Printed page')).toHaveLength(2),
  );
  await fireEvent.press(screen.getAllByRole('button', { name: '↑' })[1]);
  expect(screen.getByText(/1\. page-.*\.jpg/)).toBeTruthy();
  await fireEvent.changeText(
    screen.getByLabelText('Book title'),
    'Collected pages',
  );
  jest
    .mocked(uploadMedia)
    .mockResolvedValueOnce(secondAssetId)
    .mockResolvedValueOnce(firstAssetId);
  await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() =>
    expect(view.router.replace).toHaveBeenCalledWith(`/sources/${sourceId}`),
  );
  expect(
    jest
      .mocked(uploadMedia)
      .mock.calls.map(([, file]) => [file.name, file.mimeType]),
  ).toEqual([
    [expect.stringMatching(/^page-.*\.jpg$/), 'image/jpeg'],
    ['one.jpg', 'image/jpeg'],
  ]);
  expect(view.commands.mock.calls.at(-1)?.[2].body).toEqual(
    expect.objectContaining({
      registration: expect.objectContaining({
        assets: [
          {
            assetId: secondAssetId,
            order: 0,
            printedPageLabel: null,
            presentation: { rotationQuarterTurns: 0, crop: null },
          },
          {
            assetId: firstAssetId,
            order: 1,
            printedPageLabel: null,
            presentation: { rotationQuarterTurns: 0, crop: null },
          },
        ],
      }),
    }),
  );
});
