import { expect, it, jest } from '@jest/globals';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import { editDraftDetailSchema, recordDetailSchema } from '@antica/contracts';

import { collectionRecord, renderMobile } from '../../mobile.spec.fixtures';

import { CaptureContainer } from './CaptureContainer';
import {
  transcriptionId,
  editDraftId,
  observationId,
  nameProposalId,
  readCapture,
  submitCapture,
  editing,
} from './transcript.spec.fixtures';

jest.mock('../../auth', () => ({ useAuth: jest.fn() }));
jest.mock('./media-upload', () => ({
  uploadMedia: jest.fn(async () => '00000000-0000-4000-8000-000000000044'),
}));
jest.mock('expo-crypto', () => ({
  randomUUID:
    jest.requireActual<typeof import('node:crypto')>('node:crypto').randomUUID,
}));
jest.mock('expo-file-system', () => ({ File: jest.fn() }));
jest.mock('expo-router', () => ({
  useRouter: jest.fn(),
  useLocalSearchParams: () => ({
    recordId: '00000000-0000-4000-8000-000000000001',
  }),
}));
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async (key: string) =>
    key.includes('transcriptionJob.')
      ? '00000000-0000-4000-8000-000000000041'
      : key.includes('transcription.')
        ? '00000000-0000-4000-8000-000000000040'
        : null,
  ),
  setItemAsync: jest.fn(async () => undefined),
}));
jest.mock('expo-audio', () => ({
  useAudioRecorder: () => ({}),
  RecordingPresets: { HIGH_QUALITY: {} },
}));
jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: async () => ({
    canceled: false,
    assets: [
      { uri: 'file:///vase.jpg', fileName: 'vase.jpg', mimeType: 'image/jpeg' },
    ],
  }),
}));

it('should confirm recovered words explicitly and preserve only adopted fields when saving', async () => {
  const view = await renderMobile(<CaptureContainer />, {
    get: readCapture,
    post: submitCapture,
  });
  await openRecoveredWords();
  expect(view.commands).not.toHaveBeenCalled();
  await fireEvent.changeText(
    screen.getByLabelText('Original words'),
    'Collector corrected words',
  );
  await fireEvent.press(
    screen.getByRole('button', { name: 'Confirm original words' }),
  );
  await waitFor(() =>
    expect(screen.getByText('Original words confirmed')).toBeTruthy(),
  );
  await selectNameProposal();
  await fireEvent.press(
    screen.getByRole('button', { name: 'Apply selected changes (1)' }),
  );
  await waitFor(() =>
    expect(
      screen.queryByRole('button', { name: 'Apply selected changes (1)' }),
    ).toBeNull(),
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
  expect(screen.getByLabelText('Name')).toHaveDisplayValue('Adopted name');
  await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(view.router.replace).toHaveBeenCalled());
  expectSelectedRequests(view);
  expect(view.patches.mock.calls[0]?.[2].body).toEqual(
    expect.objectContaining({
      expectedRevision: 2,
      fields: expect.objectContaining({
        name: 'Adopted name',
        description: '',
      }),
    }),
  );
});

it('should retain the same confirmation and adoption requests after network failures', async () => {
  const view = await renderMobile(<CaptureContainer />, {
    get: readCapture,
    post: submitCapture,
  });
  await openRecoveredWords();
  view.commands.mockRejectedValueOnce(
    new Error('Confirmation connection lost'),
  );
  await fireEvent.press(
    screen.getByRole('button', { name: 'Confirm original words' }),
  );
  await waitFor(() =>
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Confirmation connection lost',
    ),
  );
  expect(screen.getByLabelText('Original words')).toHaveDisplayValue(
    'Recovered words',
  );
  await fireEvent.press(
    screen.getByRole('button', { name: 'Confirm original words' }),
  );
  await waitFor(() =>
    expect(screen.getByText('Original words confirmed')).toBeTruthy(),
  );
  expect(view.commands.mock.calls[1]?.[2]).toEqual(
    view.commands.mock.calls[0]?.[2],
  );
  await selectNameProposal();
  view.commands.mockRejectedValueOnce(new Error('Adoption connection lost'));
  await fireEvent.press(
    screen.getByRole('button', { name: 'Apply selected changes (1)' }),
  );
  await waitFor(() =>
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Adoption connection lost',
    ),
  );
  await fireEvent.press(
    screen.getByRole('button', { name: 'Apply selected changes (1)' }),
  );
  await waitFor(() =>
    expect(
      screen.queryByRole('button', { name: 'Apply selected changes (1)' }),
    ).toBeNull(),
  );
  expect(view.commands.mock.calls[4]?.[2]).toEqual(
    view.commands.mock.calls[3]?.[2],
  );
});

it.each([
  { label: 'removal', tags: [] },
  { label: 'replacement', tags: ['porcelain'] },
])(
  'should adopt a tag-$label proposal without replacing the existing record name',
  async ({ tags }) => {
    const tagProposalId = '00000000-0000-4000-8000-000000000048';
    const record = recordDetailSchema.parse({
      ...collectionRecord,
      name: 'Collector name',
      tags: ['provisional'],
    });
    const detail = editDraftDetailSchema.parse({
      ...editing,
      result: {
        ...editing.result,
        proposedChanges: [
          {
            id: tagProposalId,
            field: 'tags',
            before: ['provisional'],
            proposed: tags,
            findingIds: [],
          },
        ],
      },
    });
    const view = await renderMobile(<CaptureContainer />, {
      get: async (path) =>
        path.startsWith('/v1/records/')
          ? record
          : path.startsWith('/v1/edit-drafts/')
            ? detail
            : readCapture(path),
      post: async (path) =>
        path.endsWith('/apply')
          ? { record: { ...record, tags, recordRevision: 2 } }
          : submitCapture(path),
    });
    await openRecoveredWords();
    await fireEvent.press(
      screen.getByRole('button', { name: 'Confirm original words' }),
    );
    await waitFor(() =>
      expect(screen.getByText('Original words confirmed')).toBeTruthy(),
    );
    await fireEvent.press(
      screen.getByRole('button', { name: 'Prepare description' }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Select proposal' }),
      ).toBeTruthy(),
    );
    await fireEvent.press(
      screen.getByRole('button', { name: 'Select proposal' }),
    );
    await fireEvent.press(
      screen.getByRole('button', { name: 'Apply selected changes (1)' }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'Apply selected changes (1)' }),
      ).toBeNull(),
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByLabelText('Name')).toHaveDisplayValue('Collector name');
    expect(screen.getByLabelText('Object type tag')).toHaveDisplayValue(
      tags[0] ?? '',
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(view.router.replace).toHaveBeenCalled());
    expect(view.patches.mock.calls[0]?.[2].body).toMatchObject({
      fields: { name: 'Collector name', tags },
    });
    view.client.clear();
  },
);

it('should clear the name field when an adopted proposal removes the record name', async () => {
  const record = recordDetailSchema.parse({
    ...collectionRecord,
    name: 'Provisional name',
  });
  const detail = editDraftDetailSchema.parse({
    ...editing,
    result: {
      ...editing.result,
      proposedChanges: [
        {
          id: nameProposalId,
          field: 'name',
          before: 'Provisional name',
          proposed: null,
          findingIds: [],
        },
      ],
    },
  });
  const view = await renderMobile(<CaptureContainer />, {
    get: async (path) =>
      path.startsWith('/v1/records/')
        ? record
        : path.startsWith('/v1/edit-drafts/')
          ? detail
          : readCapture(path),
    post: async (path) =>
      path.endsWith('/apply')
        ? { record: { ...record, name: null, recordRevision: 2 } }
        : submitCapture(path),
  });
  await openRecoveredWords();
  await fireEvent.press(
    screen.getByRole('button', { name: 'Confirm original words' }),
  );
  await waitFor(() =>
    expect(screen.getByText('Original words confirmed')).toBeTruthy(),
  );
  await fireEvent.press(
    screen.getByRole('button', { name: 'Prepare description' }),
  );
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Select proposal' }),
    ).toBeTruthy(),
  );
  await fireEvent.press(
    screen.getByRole('button', { name: 'Select proposal' }),
  );
  await fireEvent.press(
    screen.getByRole('button', { name: 'Apply selected changes (1)' }),
  );
  await waitFor(() =>
    expect(
      screen.queryByRole('button', { name: 'Apply selected changes (1)' }),
    ).toBeNull(),
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
  expect(screen.getByLabelText('Name')).toHaveDisplayValue('');
  view.client.clear();
});

/** Opens imported evidence and restored transcript through the capture controls. */
async function openRecoveredWords(): Promise<void> {
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Import file' })).toBeTruthy(),
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Import file' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
  await waitFor(() =>
    expect(screen.getByLabelText('Original words')).toHaveDisplayValue(
      'Recovered words',
    ),
  );
}

/** Opens the edit draft and selects only its name proposal. */
async function selectNameProposal(): Promise<void> {
  await fireEvent.press(
    screen.getByRole('button', { name: 'Prepare description' }),
  );
  await waitFor(() =>
    expect(
      screen.getAllByRole('button', { name: 'Select proposal' }),
    ).toHaveLength(2),
  );
  await fireEvent.press(
    screen.getAllByRole('button', { name: 'Select proposal' })[0],
  );
}

/**
 * Checks confirmation and selective adoption at the API boundary.
 * @param view Rendered capture harness.
 */
function expectSelectedRequests(
  view: Awaited<ReturnType<typeof renderMobile>>,
): void {
  expect(
    view.commands.mock.calls.map(([path, , options]) => ({
      path,
      body: options.body,
    })),
  ).toEqual([
    {
      path: `/v1/transcriptions/${transcriptionId}/confirm`,
      body: expect.objectContaining({
        adoptedTextZhHant: 'Collector corrected words',
        expectedRevision: 2,
      }),
    },
    {
      path: '/v1/edit-drafts',
      body: expect.objectContaining({
        transcriptionIds: [transcriptionId],
        observationIds: [observationId],
      }),
    },
    {
      path: `/v1/edit-drafts/${editDraftId}/apply`,
      body: expect.objectContaining({
        selectedProposalIds: [nameProposalId],
        expectedDraftRevision: 3,
      }),
    },
  ]);
}
