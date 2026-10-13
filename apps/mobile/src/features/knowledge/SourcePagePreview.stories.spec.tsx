import { expect, it, jest } from '@jest/globals';
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';

import { manipulateAsync } from 'expo-image-manipulator';

import meta, {
  CroppedAndRotated,
  FailedPreparation,
  OriginalAndPrepared,
} from './SourcePagePreview.stories';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
}));
jest.mock('expo-image-manipulator', () => ({
  SaveFormat: { JPEG: 'jpeg' },
  manipulateAsync: jest.fn(async () => ({
    uri: 'file:///prepared.jpg',
    width: 4,
    height: 4,
  })),
}));

it('should report the selected original-image point in the preview story', async () => {
  const OriginalStory = OriginalAndPrepared.render;
  await render(meta.decorators[0](() => <OriginalStory {...meta.args} />));
  expect(screen.getByLabelText('Book page')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Select region' }), {
    nativeEvent: { locationX: 65, locationY: 65 },
  });
  expect(screen.getByText('Selected 0.25, 0.50')).toBeTruthy();
  expect(screen.getByLabelText(/^Book page, /)).toBeTruthy();
});

it('should preserve the original while the cropped and rotated story prepares a preview', async () => {
  const CroppedStory = CroppedAndRotated.render;
  await render(
    meta.decorators[0](() => (
      <CroppedStory {...meta.args} {...CroppedAndRotated.args} />
    )),
  );
  expect(screen.getByLabelText('Book page')).toHaveProp('source', {
    uri: meta.args.uri,
  });
  await waitFor(() =>
    expect(screen.getByLabelText(/^Book page, /)).toHaveProp('source', {
      uri: 'file:///prepared.jpg',
    }),
  );
  expect(manipulateAsync).toHaveBeenCalledWith(
    meta.args.uri,
    [{ crop: { originX: 2, originY: 0, width: 4, height: 4 } }, { rotate: 90 }],
    { format: 'jpeg' },
  );
});

it('should retain the original and expose retry when the failed preparation story cannot transform', async () => {
  jest
    .mocked(manipulateAsync)
    .mockRejectedValueOnce(new Error('Image preparation failed'));
  const FailedStory = FailedPreparation.render;
  await render(
    meta.decorators[0](() => (
      <FailedStory {...meta.args} {...FailedPreparation.args} />
    )),
  );
  await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
  expect(screen.getByLabelText('Book page')).toHaveProp('source', {
    uri: meta.args.uri,
  });
  expect(screen.queryByLabelText(/^Book page, /)).toBeNull();
  expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled();
});
