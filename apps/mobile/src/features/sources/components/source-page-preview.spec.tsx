import { expect, it, jest } from '@jest/globals';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';

import { manipulateAsync } from 'expo-image-manipulator';
import { Platform } from 'react-native';

import { savedPreferences } from '../../../i18n/preferences.spec.fixtures';
import { renderMobile } from '../../../mobile.spec.fixtures';
import { LocaleProvider } from '../../../providers/LocaleProvider';

import { SourcePagePreview } from './SourcePagePreview';

jest.mock('../../../providers/AuthProvider', () => ({ useAuth: jest.fn() }));
jest.mock('expo-router', () => ({ useRouter: jest.fn() }));
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
}));
jest.mock('expo-image-manipulator', () => ({
  SaveFormat: { JPEG: 'jpeg' },
  manipulateAsync: jest.fn(async () => ({ uri: 'file:///prepared.jpg' })),
}));

const base = {
  uri: 'file:///original.jpg',
  name: 'Page one',
  width: 1000,
  height: 500,
  displayWidth: 300,
  rotationQuarterTurns: 0 as const,
  crop: null,
};
const quarter = 0.25;
const threeQuarters = 0.75;
const half = 0.5;

it.each(['ios', 'web'] as const)(
  'should show the original immediately and report normalized responder coordinates on %s',
  async (platform) => {
    jest.replaceProperty(Platform, 'OS', platform);
    const onCrop = jest.fn<(x: number, y: number) => void>();
    await renderMobile(<SourcePagePreview {...base} onCrop={onCrop} />, {});
    expect(screen.getByLabelText('Page one')).toHaveProp('source', {
      uri: base.uri,
    });
    await fireEvent.press(
      screen.getByRole('button', { name: 'Select region' }),
      {
        nativeEvent: { locationX: 75, locationY: 112.5 },
      },
    );
    expect(onCrop).toHaveBeenCalledWith(quarter, threeQuarters);
    expect(manipulateAsync).not.toHaveBeenCalled();
  },
);

it('should map a browser pointer click to the original image without native location coordinates', async () => {
  jest.replaceProperty(Platform, 'OS', 'web');
  const onCrop = jest.fn<(x: number, y: number) => void>();
  await renderMobile(
    <SourcePagePreview {...base} rotationQuarterTurns={1} onCrop={onCrop} />,
    {},
  );
  await fireEvent(
    screen.getByRole('button', { name: 'Select region' }),
    'press',
    {
      nativeEvent: { clientX: 100.125, clientY: 110.1875, detail: 1 },
      currentTarget: {
        getBoundingClientRect: () => ({
          left: 40,
          top: 20,
          width: 240.5,
          height: 120.25,
        }),
      },
    },
  );
  expect(onCrop).toHaveBeenCalledWith(quarter, threeQuarters);
});

it.each([
  { platform: 'ios' as const, nativeEvent: {} },
  { platform: 'web' as const, nativeEvent: {} },
  {
    platform: 'web' as const,
    nativeEvent: { clientX: 0, clientY: 0, detail: 0 },
  },
])(
  'should select the image center for coordinate-free accessibility activation (%j)',
  async ({ platform, nativeEvent }) => {
    jest.replaceProperty(Platform, 'OS', platform);
    const onCrop = jest.fn<(x: number, y: number) => void>();
    await renderMobile(<SourcePagePreview {...base} onCrop={onCrop} />, {});
    await fireEvent(
      screen.getByRole('button', { name: 'Select region' }),
      'press',
      {
        nativeEvent,
        currentTarget: {
          getBoundingClientRect: () => ({
            left: 40,
            top: 20,
            width: 300,
            height: 150,
          }),
        },
      },
    );
    expect(onCrop).toHaveBeenCalledWith(half, half);
  },
);

it('should crop original coordinates before rotating the preview', async () => {
  await renderMobile(
    <SourcePagePreview
      {...base}
      crop={{ kind: 'rect', x: 0.1, y: 0.2, width: 0.35, height: 0.4 }}
      rotationQuarterTurns={1}
      onCrop={jest.fn()}
    />,
    {},
  );
  await waitFor(() =>
    expect(
      screen.getByLabelText('Page one, Crop and rotation preview'),
    ).toHaveProp('source', { uri: 'file:///prepared.jpg' }),
  );
  expect(manipulateAsync).toHaveBeenCalledWith(
    base.uri,
    [
      { crop: { originX: 100, originY: 100, width: 350, height: 200 } },
      { rotate: 90 },
    ],
    { format: 'jpeg' },
  );
});

it('should keep the original available and retry when preparation fails', async () => {
  jest
    .mocked(manipulateAsync)
    .mockRejectedValueOnce(new Error('Cannot prepare'));
  await renderMobile(
    <SourcePagePreview {...base} rotationQuarterTurns={2} onCrop={jest.fn()} />,
    {},
  );
  expect(screen.getByLabelText('Page one')).toHaveProp('source', {
    uri: base.uri,
  });
  await waitFor(() =>
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Something went wrong.',
    ),
  );
  expect(
    screen.queryByLabelText('Page one, Crop and rotation preview'),
  ).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: 'Retry' }));
  await waitFor(() =>
    expect(
      screen.getByLabelText('Page one, Crop and rotation preview'),
    ).toHaveProp('source', { uri: 'file:///prepared.jpg' }),
  );
  expect(screen.queryByRole('alert')).toBeNull();
});

it('should ignore stale preparation results after the requested transform changes', async () => {
  const first =
    Promise.withResolvers<Awaited<ReturnType<typeof manipulateAsync>>>();
  const second =
    Promise.withResolvers<Awaited<ReturnType<typeof manipulateAsync>>>();
  jest
    .mocked(manipulateAsync)
    .mockImplementationOnce(async () => first.promise)
    .mockImplementationOnce(async () => second.promise);
  const onCrop = jest.fn<(x: number, y: number) => void>();
  const view = await render(
    <LocaleProvider preferences={savedPreferences('en')}>
      <SourcePagePreview {...base} rotationQuarterTurns={1} onCrop={onCrop} />
    </LocaleProvider>,
  );
  await view.rerender(
    <LocaleProvider preferences={savedPreferences('en')}>
      <SourcePagePreview {...base} rotationQuarterTurns={2} onCrop={onCrop} />
    </LocaleProvider>,
  );
  await act(async () => {
    first.resolve({ uri: 'file:///stale.jpg', width: 300, height: 150 });
    await first.promise;
  });
  expect(
    screen.queryByLabelText('Page one, Crop and rotation preview'),
  ).toBeNull();
  await view.rerender(
    <LocaleProvider preferences={savedPreferences('en')}>
      <SourcePagePreview {...base} rotationQuarterTurns={3} onCrop={onCrop} />
    </LocaleProvider>,
  );
  await act(async () => {
    second.reject(new Error('Stale failure'));
    await expect(second.promise).rejects.toThrow('Stale failure');
  });
  await waitFor(() =>
    expect(
      screen.getByLabelText('Page one, Crop and rotation preview'),
    ).toHaveProp('source', { uri: 'file:///prepared.jpg' }),
  );
  expect(screen.queryByRole('alert')).toBeNull();
});
