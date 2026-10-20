import { expect, it, jest } from '@jest/globals';
import { QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import { View } from 'react-native';

import { SafeAreaProvider } from 'react-native-safe-area-context';

import {
  observationSchema,
  recordDetailSchema,
  recordPageSchema,
} from '@antica/contracts';

import CollectionRoute from '../../../app/(private)/(tabs)/collection';
import {
  collectionRecord,
  deviceMetrics,
  renderMobile,
} from '../../../mobile.spec.fixtures';
import { LocaleProvider } from '../../../providers/LocaleProvider';

import { RecordContainer } from '../../collection/containers/RecordContainer';
import { RecordEditContainer } from '../../collection/containers/RecordEditContainer';

import { CaptureContainer } from './CaptureContainer';

import type { QueryClient } from '@tanstack/react-query';

import type { ReactElement } from 'react';

jest.mock('../../../providers/AuthProvider', () => ({ useAuth: jest.fn() }));
jest.mock('../../today/hooks/useTodayInbox', () => ({
  // 藏品 heads its list with 今天's counts; the inbox's own reads are covered by the today specs
  useTodayInbox: () => ({
    items: [],
    records: [],
    recordCount: 0,
    analysed: null,
    loading: false,
    error: null,
    settling: false,
    partialError: null,
    retry: () => undefined,
  }),
}));
jest.mock('../../../adapters/media-upload', () => ({
  uploadMedia: jest.fn(async () => '00000000-0000-4000-8000-000000000077'),
}));
jest.mock('expo-crypto', () => ({
  randomUUID:
    jest.requireActual<typeof import('node:crypto')>('node:crypto').randomUUID,
}));
jest.mock('expo-file-system', () => ({ File: jest.fn() }));
jest.mock('expo-router', () => ({
  useFocusEffect: jest.fn(),
  useRouter: jest.fn(),
  useLocalSearchParams: () => ({
    recordId: '00000000-0000-4000-8000-000000000001',
  }),
}));
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
}));
jest.mock('expo-audio', () => ({
  useAudioRecorder: () => ({}),
  RecordingPresets: { HIGH_QUALITY: {} },
}));
jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: jest.fn(async () => ({
    canceled: false,
    assets: [
      {
        uri: 'file:///vase.jpg',
        fileName: 'vase.jpg',
        mimeType: 'image/jpeg',
        width: 640,
        height: 480,
      },
    ],
  })),
}));

type Surface = 'record' | 'edit' | 'capture' | 'collection';

const original = recordDetailSchema.parse({
  ...collectionRecord,
  name: 'Original name',
});
const saved = recordDetailSchema.parse({
  ...original,
  name: 'Updated bowl',
  recordRevision: 2,
});
const observation = observationSchema.parse({
  id: '00000000-0000-4000-8000-000000000076',
  recordId: original.id,
  componentIds: [],
  channel: 'typed',
  text: 'A dark firing mark is visible under the foot',
  evidenceAnchorIds: [],
  checkIds: [],
  observedAt: original.createdAt,
  voice: null,
  editDraftId: null,
  supersedesObservationId: null,
  author: 'collector',
  createdAt: original.createdAt,
  supersededByObservationId: null,
});
const emptyPage = { items: [], nextCursor: null };

it('should refresh the mounted record and collection screens before returning from capture save', async () => {
  const resources = new Map<string, unknown>([
    ['record', original],
    ['collection', collectionPage(original)],
    ['observations', emptyPage],
  ]);
  const view = await renderMobile(<ReturnJourney surface="record" />, {
    get: async (path) => readResource(resources, path),
    patch: async () => {
      resources.set('record', saved);
      resources.set('collection', collectionPage(saved));

      return saved;
    },
  });
  await waitFor(() =>
    expect(screen.getByRole('header', { name: original.name! })).toBeTruthy(),
  );
  // 補充證據 lives under 查驗 while that segment is a placeholder
  await fireEvent.press(screen.getByTestId('record-segment-checks'));
  await fireEvent.press(screen.getByRole('button', { name: 'Add evidence' }));
  await showSurface(view.client, 'capture');
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Import file' })).toBeTruthy(),
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Import file' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Next' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
  await fireEvent.changeText(screen.getByLabelText('Name'), saved.name!);
  await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() =>
    expect(view.router.replace).toHaveBeenCalledWith(
      `/collection/${original.id}`,
    ),
  );
  await showSurface(view.client, 'record');
  expect(screen.getByRole('header', { name: saved.name! })).toBeTruthy();
  expect(screen.queryByRole('header', { name: original.name! })).toBeNull();
  await showSurface(view.client, 'collection');
  expect(
    screen.getByRole('button', { name: `${saved.code}, ${saved.name}` }),
  ).toBeTruthy();
  view.client.clear();
});

it('should refresh the mounted collection title after saving a record edit', async () => {
  const resources = new Map<string, unknown>([
    ['record', original],
    ['collection', collectionPage(original)],
    ['observations', emptyPage],
  ]);
  const view = await renderMobile(<ReturnJourney surface="collection" />, {
    get: async (path) => readResource(resources, path),
    patch: async () => {
      resources.set('record', saved);
      resources.set('collection', collectionPage(saved));

      return saved;
    },
  });
  await waitFor(() =>
    expect(
      screen.getByRole('button', {
        name: `${original.code}, ${original.name}`,
      }),
    ).toBeTruthy(),
  );
  await showSurface(view.client, 'record');
  await fireEvent.press(await screen.findByTestId('record-edit'));
  expect(view.router.push).toHaveBeenCalledWith(
    `/collection/${original.id}/edit`,
  );
  await showSurface(view.client, 'edit');
  await fireEvent.changeText(
    await screen.findByTestId('record-edit-field-name'),
    saved.name!,
  );
  await fireEvent.press(screen.getByTestId('record-edit-save'));
  await waitFor(() => expect(view.router.back).toHaveBeenCalled());
  await showSurface(view.client, 'record');
  expect(await screen.findByRole('header', { name: saved.name! })).toBeTruthy();
  await showSurface(view.client, 'collection');
  expect(
    screen.getByRole('button', { name: `${saved.code}, ${saved.name}` }),
  ).toBeTruthy();
  expect(
    screen.queryByRole('button', {
      name: `${original.code}, ${original.name}`,
    }),
  ).toBeNull();
  view.client.clear();
});

it('should refresh mounted observations immediately after confirming original words', async () => {
  const resources = new Map<string, unknown>([
    ['record', original],
    ['collection', collectionPage(original)],
    ['observations', emptyPage],
  ]);
  const view = await renderMobile(<ReturnJourney surface="record" />, {
    get: async (path) => readResource(resources, path),
  });
  view.commands.mockImplementation(async () => {
    resources.set('observations', { items: [observation], nextCursor: null });

    return observation;
  });
  await waitFor(() =>
    expect(screen.getByRole('header', { name: original.name! })).toBeTruthy(),
  );
  // 補充證據 lives under 查驗 while that segment is a placeholder
  await fireEvent.press(screen.getByTestId('record-segment-checks'));
  await fireEvent.press(screen.getByRole('button', { name: 'Add evidence' }));
  await showSurface(view.client, 'capture');
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Import file' })).toBeTruthy(),
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Next' }));
  await fireEvent.changeText(
    screen.getByLabelText('Original words'),
    observation.text,
  );
  await fireEvent.press(
    screen.getByRole('button', { name: 'Confirm original words' }),
  );
  await waitFor(() =>
    expect(screen.getByText('Original words confirmed')).toBeTruthy(),
  );
  await showSurface(view.client, 'record');
  expect(screen.getByText(observation.text)).toBeTruthy();
  view.client.clear();
});

/**
 * keeps earlier native-stack screens mounted while the capture route is shown
 * @param root0 visible navigation surface.
 * @param root0.surface screen shown after navigation.
 * @returns mounted native stack screens
 */
function ReturnJourney({
  surface,
}: Readonly<{ surface: Surface }>): ReactElement {
  return (
    <>
      <View style={{ display: surface === 'record' ? 'flex' : 'none' }}>
        <RecordContainer recordId={original.id} />
      </View>
      <View style={{ display: surface === 'collection' ? 'flex' : 'none' }}>
        <CollectionRoute />
      </View>
      {surface === 'edit' && <RecordEditContainer recordId={original.id} />}
      {surface === 'capture' && <CaptureContainer />}
    </>
  );
}

/**
 * applies the navigation result while preserving the mounted screen instances
 * @param client shared cache for the navigation stack.
 * @param surface screen shown after navigation.
 */
async function showSurface(
  client: QueryClient,
  surface: Surface,
): Promise<void> {
  await screen.rerender(
    <SafeAreaProvider initialMetrics={deviceMetrics}>
      <QueryClientProvider client={client}>
        <LocaleProvider>
          <ReturnJourney surface={surface} />
        </LocaleProvider>
      </QueryClientProvider>
    </SafeAreaProvider>,
  );
}

/**
 * supplies persisted resource state through the mobile transport boundary
 * @param resources persisted transport resources.
 * @param path requested API resource.
 * @returns current persisted resource
 */
function readResource(resources: Map<string, unknown>, path: string): unknown {
  if (path === '/v1/locations') {
    return [];
  }
  if (path.startsWith('/v1/records?')) {
    return resources.get('collection');
  }
  if (path.endsWith('/observations')) {
    return resources.get('observations');
  }
  if (
    path.endsWith('/references') ||
    path.includes('/messages') ||
    path.startsWith('/v1/knowledge?')
  ) {
    return emptyPage;
  }

  return resources.get('record');
}

/**
 * builds the API collection projection of one persisted record
 * @param record persisted record detail.
 * @returns valid collection API projection
 */
function collectionPage(
  record: typeof original,
): ReturnType<typeof recordPageSchema.parse> {
  return recordPageSchema.parse({
    items: [
      {
        id: record.id,
        code: record.code,
        name: record.name,
        analysisFreshness: record.analysisFreshness,
        coverThumbnail: null,
        locationLabel: null,
        pendingCheckCount: 0,
      },
    ],
    nextCursor: null,
  });
}
