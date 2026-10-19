import { beforeEach, expect, it, jest } from '@jest/globals';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import { uploadMedia } from '../../../adapters/media-upload';
import { collectionRecord, renderMobile } from '../../../mobile.spec.fixtures';

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

const setRecord = { ...collectionRecord, unitKind: 'set' as const };

/**
 * gives one grid photo a component label, typing it when it is not on offer yet
 * @param item spoken name of the photo, such as Photo 1
 * @param label component label to give
 */
async function label(item: string, label: string): Promise<void> {
  await fireEvent.press(
    screen.getByRole('button', {
      name: `Change the component label of ${item}`,
    }),
  );
  const offered = screen.queryByRole('radio', { name: label });
  if (offered) {
    await fireEvent.press(offered);

    return;
  }
  await fireEvent.press(screen.getByRole('button', { name: 'New label…' }));
  await fireEvent.changeText(screen.getByLabelText('New label name'), label);
  await fireEvent.press(screen.getByRole('button', { name: 'Use this label' }));
}

/** label of each of the six saved photos, in capture order; Complete set is the whole record */
const labels = [
  'Complete set',
  'Complete set',
  'Left vase',
  'Right vase',
  'Left vase',
  'Right vase',
];

/** fields the capture patches onto the record when saving */
interface SavedFields {
  components: Array<{ id: string; label: string }>;
  pieceCount?: number;
  unitKind: string;
}

/**
 * shoots six photos of the set plus a seventh, then leaves the seventh out in the grid
 * @returns resolves once the grid shows six selected photos
 */
async function shootSet(): Promise<void> {
  await fireEvent.press(screen.getByRole('button', { name: 'Set' }));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Photo' })).toBeTruthy(),
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Photo' }));
  await shoot([
    'Complete set',
    'Complete set',
    'Base',
    'Base',
    'Mark',
    'Detail',
    'Detail',
  ]);
  await fireEvent.press(screen.getByTestId('capture-camera-last-shot'));
  await fireEvent.press(
    screen.getByRole('checkbox', { name: 'Save Photo 7: No label' }),
  );
  await waitFor(() => expect(screen.getByText('6 selected')).toBeTruthy());
}

/**
 * labels the six photos, then walks past the words and details to Save
 * @returns resolves once Save has been pressed
 */
async function labelAndSave(): Promise<void> {
  for (const [index, component] of labels.entries()) {
    await label(`Photo ${index + 1}`, component);
  }
  for (const name of ['Next', 'Continue', 'Continue']) {
    await fireEvent.press(screen.getByRole('button', { name }));
  }
  expect(screen.getAllByText(/^antica-\d+\.jpg: /)).toHaveLength(labels.length);
  await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
}

beforeEach(resetCamera);

it('should save six labelled photos of a set as one record with six media assets (PT-3)', async () => {
  jest
    .mocked(uploadMedia)
    .mockImplementation(async (_api, file) => `asset-${file.uri}`);
  const view = await renderMobile(<CaptureContainer />, {
    get: async (path) => (path === '/v1/locations' ? [] : setRecord),
    post: async () => setRecord,
    patch: async () => setRecord,
  });
  await shootSet();
  await labelAndSave();
  await waitFor(() =>
    expect(view.router.replace).toHaveBeenCalledWith(
      `/collection/${setRecord.id}`,
    ),
  );

  // one record: the draft created once, then patched once with the two typed components
  expect(view.commands.mock.calls.map(([path]) => path)).toEqual([
    '/v1/records',
  ]);
  expect(view.patches).toHaveBeenCalledTimes(1);
  const fields = (
    view.patches.mock.calls[0]?.[2].body as { fields: SavedFields }
  ).fields;

  expect(fields.unitKind).toBe('set');
  // the piece count is the collector's to give, never derived from labels (FR-2)
  expect(fields).not.toHaveProperty('pieceCount');
  expect(fields.components.map((component) => component.label)).toEqual([
    'Left vase',
    'Right vase',
  ]);
  // six media assets on that record: the whole-record photos name no component
  const idOf: Record<string, string[]> = Object.fromEntries(
    fields.components.map((component) => [component.label, [component.id]]),
  );

  expect(
    jest
      .mocked(uploadMedia)
      .mock.calls.map(([, file, target, componentIds]) => ({
        uri: file.uri,
        target,
        componentIds,
      })),
  ).toEqual(
    labels.map((component, index) => ({
      uri: `file:///shot-${index + 1}.jpg`,
      target: { kind: 'record', id: setRecord.id },
      componentIds: idOf[component] ?? [],
    })),
  );
  view.client.clear();
});
