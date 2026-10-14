import { expect, it, jest } from '@jest/globals';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import { useLocalSearchParams } from 'expo-router';
import { getItemAsync } from 'expo-secure-store';
import { Linking } from 'react-native';

import { knowledgeDetailSchema, knowledgePageSchema } from '@antica/contracts';

import KnowledgeRoute from '../../app/(private)/(tabs)/knowledge';
import KnowledgeDetailRoute from '../../app/(private)/knowledge/[entryId]';
import { renderMobile } from '../../mobile.spec.fixtures';

jest.mock('../../auth', () => ({ useAuth: jest.fn() }));
jest.mock('expo-router', () => ({
  useRouter: jest.fn(),
  useLocalSearchParams: jest.fn(),
}));
jest.mock('expo-crypto', () => ({
  randomUUID:
    jest.requireActual<typeof import('node:crypto')>('node:crypto').randomUUID,
}));
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
}));

const entryId = '00000000-0000-4000-8000-000000000061';
const sourceId = '00000000-0000-4000-8000-000000000062';
const pageId = '00000000-0000-4000-8000-000000000063';
const citationId = '00000000-0000-4000-8000-000000000064';
const locator = {
  kind: 'page' as const,
  sourceId,
  sourceVersionId: sourceId,
  pageId,
  pageIndex: 2,
  printedPageLabel: 'iii',
  canonicalViewId: pageId,
  regionId: null,
  region: null,
  textRange: null,
};
const citation = {
  id: citationId,
  locator,
  relation: 'supports' as const,
  availability: 'stored' as const,
  verification: 'located' as const,
};
const entry = knowledgeDetailSchema.parse({
  entry: {
    id: entryId,
    revision: 3,
    createdAt: '2026-10-13T00:00:00.000Z',
    updatedAt: '2026-10-13T00:00:00.000Z',
    displayCode: 'K-1',
    status: 'draft',
    content: {
      titleZhHant: 'Glaze study',
      aliases: [],
      kinds: ['surface'],
      otherKindLabel: null,
      summary: {
        textZhHant: 'Initial summary',
        citationIds: [citationId],
        support: 'cited',
      },
      history: [
        {
          textZhHant: 'Earlier observation',
          citationIds: [],
          support: 'needs_source',
        },
      ],
      features: [],
      applicability: [],
      exampleReferenceImageIds: [],
      relatedEntryIds: [],
      citations: [citation],
    },
    methodIds: [],
    savedBy: null,
  },
  methods: [],
  methodVersions: [],
  referenceImages: [],
  citations: [citation],
});

it('should search and paginate knowledge entries and open the selected entry', async () => {
  const view = await renderMobile(<KnowledgeRoute />, {
    get: async (path) =>
      knowledgePageSchema.parse({
        items: path.includes('cursor=next')
          ? []
          : [
              {
                id: entryId,
                displayCode: 'K-1',
                revision: 3,
                titleZhHant: 'Glaze study',
                kinds: ['surface'],
                status: 'draft',
                summaryZhHant: 'Initial summary',
                citationCount: 1,
              },
            ],
        nextCursor: path.includes('cursor=next') ? null : 'next',
      }),
  });
  await waitFor(() => expect(screen.getByText('Glaze study')).toBeTruthy());
  await fireEvent.press(screen.getByRole('button', { name: 'View' }));
  expect(view.router.push).toHaveBeenCalledWith(`/knowledge/${entryId}`);
  await fireEvent.press(screen.getByRole('button', { name: 'More' }));
  await waitFor(() =>
    expect(
      view.reads.mock.calls.some(([path]) => path.includes('cursor=next')),
    ).toBe(true),
  );
  await fireEvent.changeText(screen.getByLabelText('Search'), 'blue glaze');
  await waitFor(() =>
    expect(
      view.reads.mock.calls.some(
        ([path]) => path.includes('q=blue+glaze') && !path.includes('cursor='),
      ),
    ).toBe(true),
  );
  await fireEvent.press(
    screen.getByRole('button', { name: 'Import book or page' }),
  );
  expect(view.router.push).toHaveBeenCalledWith('/sources/new');
});

it('should retry a failed knowledge list request', async () => {
  const view = await renderMobile(<KnowledgeRoute />, {
    get: async () => {
      throw new Error('Offline');
    },
  });
  await waitFor(() =>
    expect(screen.getByRole('alert')).toHaveTextContent(/\S/),
  );
  expect(screen.queryByText('Offline')).toBeNull();
  view.reads.mockResolvedValueOnce({ items: [], nextCursor: null });
  await fireEvent.press(screen.getByRole('button', { name: 'Retry' }));
  await waitFor(() =>
    expect(screen.getByText('Nothing here yet.')).toBeTruthy(),
  );
});

it.each([
  { locale: 'en', metadata: 'K-1 · Draft · Object type, Other' },
  { locale: 'zh-Hant', metadata: 'K-1 · 草稿 · 器類, 其他' },
])(
  'should localize knowledge categories without changing authored content in $locale',
  async ({ locale, metadata }) => {
    jest.mocked(getItemAsync).mockResolvedValueOnce(locale);
    await renderMobile(<KnowledgeRoute />, {
      get: async () =>
        knowledgePageSchema.parse({
          items: [
            {
              id: entryId,
              displayCode: 'K-1',
              revision: 3,
              titleZhHant: 'Collector-authored glaze study',
              kinds: ['object_type', 'other'],
              status: 'draft',
              summaryZhHant: 'Original field notes',
              citationCount: 1,
            },
          ],
          nextCursor: null,
        }),
    });

    await waitFor(() => expect(screen.getByText(metadata)).toBeTruthy());
    expect(screen.getByText('Collector-authored glaze study')).toBeTruthy();
    expect(screen.getByText('Original field notes')).toBeTruthy();
    expect(screen.queryByText(/object_type/)).toBeNull();
  },
);

it.each([
  {
    locale: 'en',
    scope: 'No scope information has been recorded for this entry.',
    methods: 'No inspection methods have been recorded for this entry.',
    name: 'Name',
  },
  {
    locale: 'zh-Hant',
    scope: '這則知識尚未記錄適用範圍。',
    methods: '這則知識尚未記錄檢查方法。',
    name: '名稱',
  },
])(
  'should explain empty saved knowledge sections without implying loading in $locale',
  async ({ locale, scope, methods, name }) => {
    jest.mocked(getItemAsync).mockResolvedValueOnce(locale);
    jest.mocked(useLocalSearchParams).mockReturnValue({ entryId });
    await renderMobile(<KnowledgeDetailRoute />, {
      get: async () => ({
        ...entry,
        entry: { ...entry.entry, status: 'saved' },
      }),
    });

    await waitFor(() => expect(screen.getByText(scope)).toBeTruthy());
    expect(screen.getByText(methods)).toBeTruthy();
    expect(screen.getByLabelText(name)).toHaveDisplayValue('Glaze study');
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  },
);

it('should save edited knowledge against its current revision and navigate to a cited page', async () => {
  jest.mocked(useLocalSearchParams).mockReturnValue({ entryId });
  const view = await renderMobile(<KnowledgeDetailRoute />, {
    get: async () => entry,
  });
  await waitFor(() =>
    expect(screen.getByLabelText('Name')).toHaveDisplayValue('Glaze study'),
  );
  await fireEvent.changeText(screen.getByLabelText('Name'), 'Revised glaze');
  await fireEvent.changeText(
    screen.getByLabelText('Summary'),
    'Collector summary',
  );
  await fireEvent.press(
    screen.getByRole('button', { name: 'View source 00000000' }),
  );
  expect(view.router.push).toHaveBeenCalledWith(
    `/sources/${sourceId}?versionId=${sourceId}&pageId=${pageId}`,
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(view.patches).toHaveBeenCalledTimes(1));
  expect(view.patches.mock.calls[0]?.[2].body).toEqual(
    expect.objectContaining({
      expectedRevision: 3,
      status: 'saved',
      content: expect.objectContaining({
        titleZhHant: 'Revised glaze',
        summary: {
          textZhHant: 'Collector summary',
          citationIds: [citationId],
          support: 'cited',
        },
      }),
    }),
  );
});

it('should preserve edits after a rejected knowledge save and report a failed external link', async () => {
  jest.mocked(useLocalSearchParams).mockReturnValue({ entryId });
  const webEntry = {
    ...entry,
    referenceImages: [
      {
        id: pageId,
        originalCaption: null,
        locator: {
          kind: 'web' as const,
          sourceId,
          sourceVersionId: sourceId,
          url: 'https://example.com/plate',
        },
      },
    ],
    citations: [
      {
        ...citation,
        locator: {
          kind: 'web' as const,
          sourceId,
          sourceVersionId: sourceId,
          url: 'https://example.com/source',
          retrievedAt: '2026-10-13T00:00:00.000Z',
          snapshotAssetId: null,
          blockId: null,
          excerptAsRetrieved: null,
        },
      },
    ],
  };
  const view = await renderMobile(<KnowledgeDetailRoute />, {
    get: async () => webEntry,
  });
  await waitFor(() => expect(screen.getByLabelText('Name')).toBeTruthy());
  const open = jest
    .spyOn(Linking, 'openURL')
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(new Error('Plate unavailable'))
    .mockRejectedValueOnce(new Error('Link unavailable'));
  await fireEvent.press(screen.getByRole('button', { name: 'View source' }));
  expect(open).toHaveBeenCalledWith('https://example.com/plate');
  await fireEvent.press(screen.getByRole('button', { name: 'View source' }));
  await waitFor(() =>
    expect(screen.getByRole('alert')).toHaveTextContent('Plate unavailable'),
  );
  await fireEvent.press(
    screen.getByRole('button', { name: 'View source 00000000' }),
  );
  await waitFor(() =>
    expect(screen.getByRole('alert')).toHaveTextContent('Link unavailable'),
  );
  expect(open).toHaveBeenCalledWith('https://example.com/source');
  await fireEvent.changeText(screen.getByLabelText('Name'), 'Unsaved title');
  view.patches.mockRejectedValueOnce(new Error('Revision changed'));
  await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() =>
    expect(screen.getByRole('alert')).toHaveTextContent('Revision changed'),
  );
  expect(screen.getByLabelText('Name')).toHaveDisplayValue('Unsaved title');
});

it('should retry a failed detail load and display supported history, scope, methods and examples', async () => {
  jest.mocked(useLocalSearchParams).mockReturnValue({ entryId });
  const view = await renderMobile(<KnowledgeDetailRoute />, {
    get: async () => {
      throw new Error('Detail unavailable');
    },
  });
  await waitFor(() =>
    expect(screen.getByRole('alert')).toHaveTextContent(/\S/),
  );
  expect(screen.queryByText('Detail unavailable')).toBeNull();
  view.reads.mockResolvedValueOnce({
    ...entry,
    entry: {
      ...entry.entry,
      content: {
        ...entry.entry.content,
        summary: {
          textZhHant: 'Needs attribution',
          citationIds: [],
          support: 'needs_source',
        },
        applicability: [
          {
            scope: 'specific',
            objectTypeIds: [],
            materialIds: [],
            periodIds: [],
            regionIds: [],
            limits: {
              textZhHant: 'Glazed wares',
              citationIds: [],
              support: 'needs_source',
            },
          },
        ],
      },
    },
    methodVersions: [
      {
        id: pageId,
        definition: {
          titleZhHant: 'Inspect glaze',
          steps: [{ actionZhHant: 'Check surface' }],
        },
      },
    ],
    referenceImages: [
      { id: pageId, originalCaption: { textAsPrinted: 'Plate 3' }, locator },
    ],
  });
  await fireEvent.press(screen.getByRole('button', { name: 'Retry' }));
  await waitFor(() => expect(screen.getByLabelText('Name')).toBeTruthy());
  expect(screen.getAllByText('Source needs review').length).toBeGreaterThan(0);
  expect(
    screen.getByText('Earlier observation (Source needs review)'),
  ).toBeTruthy();
  expect(screen.getByText('specific: Glazed wares')).toBeTruthy();
  expect(screen.getByText('Inspect glaze: Check surface')).toBeTruthy();
  expect(
    screen.queryByText(
      'No scope information has been recorded for this entry.',
    ),
  ).toBeNull();
  expect(
    screen.queryByText(
      'No inspection methods have been recorded for this entry.',
    ),
  ).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: 'Plate 3' }));
  expect(view.router.push).toHaveBeenCalledWith(
    `/sources/${sourceId}?versionId=${sourceId}&pageId=${pageId}`,
  );
});

it('should preserve unedited cited content when saving a knowledge draft', async () => {
  jest.mocked(useLocalSearchParams).mockReturnValue({ entryId });
  const citedHistory = {
    ...entry,
    entry: {
      ...entry.entry,
      content: {
        ...entry.entry.content,
        history: [
          {
            textZhHant: 'Documented sequence',
            citationIds: [citationId],
            support: 'cited',
          },
        ],
      },
    },
  };
  const view = await renderMobile(<KnowledgeDetailRoute />, {
    get: async () => citedHistory,
  });
  await waitFor(() =>
    expect(screen.getByText('Documented sequence')).toBeTruthy(),
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(view.patches).toHaveBeenCalledTimes(1));
  expect(view.patches.mock.calls[0]?.[2].body).toEqual(
    expect.objectContaining({
      content: expect.objectContaining({
        titleZhHant: 'Glaze study',
        summary: entry.entry.content.summary,
      }),
    }),
  );
});
