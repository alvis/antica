import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import {
  fireEvent,
  screen,
  waitFor,
  within,
} from '@testing-library/react-native';

import {
  launchCameraAsync,
  requestCameraPermissionsAsync,
} from 'expo-image-picker';
import { getThumbnailAsync } from 'expo-video-thumbnails';

import { collectionRecord, renderMobile } from '../../../mobile.spec.fixtures';

import { CaptureGridStep } from '../components/CaptureGridStep';

import { resetCamera, shoot } from './capture-camera.spec.fixtures';
import { CaptureContainer } from './CaptureContainer';

jest.mock('../../../providers/AuthProvider', () => ({ useAuth: jest.fn() }));
jest.mock('../../../adapters/media-upload', () => ({ uploadMedia: jest.fn() }));
jest.mock('expo-crypto', () => ({
  randomUUID:
    jest.requireActual<typeof import('node:crypto')>('node:crypto').randomUUID,
}));
jest.mock('expo-file-system', () => ({ File: jest.fn() }));
jest.mock('expo-router', () => ({
  useRouter: jest.fn(),
  useLocalSearchParams: () => ({}),
}));
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
}));
jest.mock('expo-audio', () => ({
  useAudioRecorder: () => ({}),
  RecordingPresets: { HIGH_QUALITY: {} },
}));
jest.mock('expo-video-thumbnails', () => ({ getThumbnailAsync: jest.fn() }));
jest.mock(
  'expo-camera',
  () =>
    jest.requireActual<typeof import('./capture-camera.spec.fixtures')>(
      './capture-camera.spec.fixtures',
    ).expoCameraMock,
);
jest.mock('expo-image-picker', () => ({
  launchCameraAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
  requestCameraPermissionsAsync: jest.fn(async () => ({ granted: true })),
}));

/**
 * shoots photos of a new record in the in-app camera, then reviews them in the grid
 * @param kind record unit kind chosen first
 * @param shotTypes shot type of each photo
 * @returns the isolated mobile API and navigation boundaries
 */
async function openGrid(
  kind: 'Single item' | 'Set',
  shotTypes: readonly string[],
): Promise<Awaited<ReturnType<typeof renderMobile>>> {
  const view = await renderMobile(<CaptureContainer />, {
    get: async (path) => (path === '/v1/locations' ? [] : collectionRecord),
  });
  await fireEvent.press(screen.getByRole('button', { name: kind }));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Photo' })).toBeTruthy(),
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Photo' }));
  await shoot(shotTypes);
  await fireEvent.press(screen.getByTestId('capture-camera-last-shot'));

  return view;
}

/**
 * opens the label picker of one grid file
 * @param item spoken name of the file, such as Photo 1
 */
async function openPicker(item: string): Promise<void> {
  await fireEvent.press(
    screen.getByRole('button', {
      name: `Change the component label of ${item}`,
    }),
  );
}

beforeEach(resetCamera);

describe('image grid', () => {
  it('should show the record, its code, and every tile selected', async () => {
    const view = await openGrid('Set', ['Complete set', 'Base']);

    expect(screen.getByText('New item')).toBeTruthy();
    // the code also titles the capture screen
    expect(screen.getAllByText(collectionRecord.code)).toHaveLength(2);
    expect(screen.getByText('2 selected')).toBeTruthy();
    expect(
      screen.getByRole('checkbox', { name: 'Save Photo 1: No label' }),
    ).toBeChecked();
    expect(screen.getByLabelText('Photo 2: No label')).toBeTruthy();
    view.client.clear();
  });

  it('should leave a deselected file out of the count and keep it in the grid', async () => {
    const view = await openGrid('Set', ['Complete set', 'Base']);

    await fireEvent.press(
      screen.getByRole('checkbox', { name: 'Save Photo 1: No label' }),
    );

    expect(screen.getByText('1 selected')).toBeTruthy();
    expect(
      screen.getByRole('checkbox', { name: 'Save Photo 1: No label' }),
    ).not.toBeChecked();
    expect(
      screen.getByTestId('capture-grid-media-1').props.accessibilityState,
    ).toEqual({ checked: false });
    await fireEvent.press(
      screen.getByRole('checkbox', { name: 'Save Photo 1: No label' }),
    );

    expect(screen.getByText('2 selected')).toBeTruthy();
    view.client.clear();
  });
});

describe('component labels', () => {
  it('should offer the whole record, then labels already used, and never a shot type', async () => {
    const view = await openGrid('Set', ['Complete set', 'Base', 'Mark']);

    await openPicker('Photo 2');

    expect(
      screen
        .getAllByRole('radio')
        .map((radio) => radio.props.accessibilityLabel),
    ).toEqual(['Complete set']);
    await fireEvent.press(screen.getByRole('radio', { name: 'Complete set' }));

    expect(screen.getByLabelText('Photo 2: Complete set')).toBeTruthy();
    expect(
      screen.getByRole('checkbox', { name: 'Save Photo 2: Complete set' }),
    ).toBeChecked();
    await openPicker('Photo 1');
    await fireEvent.press(screen.getByRole('button', { name: 'New label…' }));

    // only the name field stays while typing, so it fits above the keyboard
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
    expect(
      screen.getByRole('button', { name: 'Use this label' }),
    ).toBeDisabled();
    await fireEvent(screen.getByLabelText('New label name'), 'submitEditing');
    await fireEvent.changeText(
      screen.getByLabelText('New label name'),
      ' Left vase ',
    );
    await fireEvent(screen.getByLabelText('New label name'), 'submitEditing');

    expect(screen.getByLabelText('Photo 1: Left vase')).toBeTruthy();
    await openPicker('Photo 3');

    expect(screen.getByText('Labels used in this item')).toBeTruthy();
    expect(
      screen
        .getAllByRole('radio')
        .map((radio) => radio.props.accessibilityLabel),
    ).toEqual(['Complete set', 'Left vase']);
    await fireEvent.press(screen.getByRole('radio', { name: 'Left vase' }));

    expect(screen.getByLabelText('Photo 3: Left vase')).toBeTruthy();
    view.client.clear();
  });

  it('should apply a typed label, then clear it, and keep it on cancel', async () => {
    const view = await openGrid('Set', ['Detail']);

    await openPicker('Photo 1');

    expect(screen.queryByRole('button', { name: 'Clear label' })).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'New label…' }));
    await fireEvent.changeText(screen.getByLabelText('New label name'), 'Lid');
    await fireEvent.press(
      screen.getByRole('button', { name: 'Use this label' }),
    );
    await openPicker('Photo 1');

    expect(screen.getByRole('radio', { name: 'Lid' })).toBeChecked();
    await fireEvent.press(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.getByLabelText('Photo 1: Lid')).toBeTruthy();
    await openPicker('Photo 1');
    await fireEvent.press(screen.getByRole('button', { name: 'Clear label' }));

    expect(screen.getByLabelText('Photo 1: No label')).toBeTruthy();
    expect(screen.queryByTestId('capture-label-picker')).toBeNull();
    view.client.clear();
  });
});

describe('uploaded files', () => {
  it('should keep an uploaded photo selected and say it is uploaded', async () => {
    const onToggle = jest.fn();
    const view = await renderMobile(
      <CaptureGridStep
        kind="set"
        recordName="Pair of vases"
        recordCode={collectionRecord.code}
        files={[
          {
            id: 'uploaded',
            uri: 'file:///uploaded.jpg',
            name: 'uploaded.jpg',
            mimeType: 'image/jpeg',
            kind: 'photo',
            purpose: 'object',
            componentLabel: '',
            state: 'uploaded',
            assetId: 'asset-uploaded',
          },
        ]}
        componentLabels={[]}
        thumbnails={{}}
        onToggle={onToggle}
        onLabel={jest.fn()}
        onAddPhoto={jest.fn()}
        onAddVideo={jest.fn()}
        onBack={jest.fn()}
        onNext={jest.fn()}
      />,
      {},
    );
    const checkbox = screen.getByRole('checkbox', {
      name: 'Save Photo 1: No label',
    });

    expect(checkbox).toBeDisabled();
    expect(checkbox).toBeChecked();
    expect(checkbox.props.accessibilityHint).toBe('Uploaded');
    await fireEvent.press(checkbox);

    expect(onToggle).not.toHaveBeenCalled();
    view.client.clear();
  });
});

describe('grid layout', () => {
  it('should hide component labels for a single item', async () => {
    const view = await openGrid('Single item', ['Complete set']);

    expect(screen.getByLabelText('Photo 1')).toBeTruthy();
    expect(screen.queryByTestId('capture-grid-label-1')).toBeNull();
    view.client.clear();
  });

  it('should return to the capture step', async () => {
    const view = await openGrid('Set', ['Complete set']);

    await fireEvent.press(screen.getByRole('button', { name: 'Back' }));

    expect(screen.getByRole('button', { name: 'Import file' })).toBeTruthy();
    view.client.clear();
  });
});

describe('video tiles', () => {
  it('should show a still for a video and the video icon when no still can be made', async () => {
    jest
      .mocked(launchCameraAsync)
      .mockResolvedValueOnce({
        canceled: false,
        assets: [{ uri: 'file:///turn.mp4', width: 640, height: 480 }],
      })
      .mockResolvedValueOnce({
        canceled: false,
        assets: [{ uri: 'file:///broken.mp4', width: 640, height: 480 }],
      });
    jest
      .mocked(getThumbnailAsync)
      .mockResolvedValueOnce({ uri: 'file:///turn.jpg', width: 64, height: 48 })
      .mockRejectedValueOnce(new Error('Unsupported codec'));
    const view = await openGrid('Set', ['Complete set']);

    await fireEvent.press(screen.getByRole('button', { name: 'Add video' }));
    await waitFor(() =>
      expect(screen.getByTestId('capture-grid-still-2').props.source).toEqual({
        uri: 'file:///turn.jpg',
      }),
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Add video' }));
    await waitFor(() => expect(getThumbnailAsync).toHaveBeenCalledTimes(2));

    expect(requestCameraPermissionsAsync).toHaveBeenCalled();
    expect(screen.getByLabelText('Video 3: No label')).toBeTruthy();
    expect(screen.getByTestId('capture-grid-video-icon-3')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(getThumbnailAsync).toHaveBeenCalledWith('file:///turn.mp4', {
      time: 0,
    });
    expect(screen.getByText('3 selected')).toBeTruthy();

    await fireEvent.press(
      screen.getByRole('button', {
        name: 'Change the component label of Video 3',
      }),
    );

    expect(
      within(screen.getByTestId('capture-label-picker')).getByText('Video 3'),
    ).toBeTruthy();
    view.client.clear();
  });
});
