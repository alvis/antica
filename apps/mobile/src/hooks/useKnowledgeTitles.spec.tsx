import { expect, it, jest } from '@jest/globals';
import { act, screen } from '@testing-library/react-native';

import { Text } from 'react-native';

import { knowledgeDetailSchema } from '@antica/contracts';

import { renderMobile, savedLanguage } from '../mobile.spec.fixtures';

import { useKnowledgeTitles } from './useKnowledgeTitles';

jest.mock('../providers/AuthProvider', () => ({ useAuth: jest.fn() }));
jest.mock('expo-router', () => ({ useRouter: jest.fn() }));

const entryId = '3d34bcdd-0000-4000-8000-000000000001';
const detail = knowledgeDetailSchema.parse({
  entry: {
    id: entryId,
    revision: 1,
    displayCode: 'K-1',
    status: 'saved',
    savedBy: 'collector',
    createdAt: '2026-10-21T00:00:00.000Z',
    updatedAt: '2026-10-21T00:00:00.000Z',
    methodIds: [],
    content: {
      titleZhHant: '盤',
      aliases: [],
      kinds: [],
      otherKindLabel: null,
      summary: { textZhHant: '', citationIds: [], support: 'needs_source' },
      history: [],
      features: [],
      applicability: [],
      exampleReferenceImageIds: [],
      relatedEntryIds: [],
      citations: [],
    },
  },
  methods: [],
  methodVersions: [],
  referenceImages: [],
  citations: [],
});

/** renders the same lookup that suggestion, edit and history values consume */
function TitleProbe(): React.JSX.Element {
  const title = useKnowledgeTitles([entryId, entryId]);

  return <Text>{title(entryId)}</Text>;
}

it('should show a neutral loading value then the title without exposing identifiers', async () => {
  let finish!: (value: typeof detail) => void;
  const pending = new Promise<typeof detail>((resolve) => {
    finish = resolve;
  });
  const view = await renderMobile(
    <TitleProbe />,
    { get: async () => pending },
    savedLanguage('zh-Hant'),
  );

  expect(screen.getByText('載入中…')).toBeVisible();
  expect(screen.queryByText(/3d34bcdd/)).toBeNull();
  expect(view.reads).toHaveBeenCalledTimes(1);
  await act(async () => finish(detail));
  expect(await screen.findByText('盤')).toBeVisible();
  expect(screen.queryByText(/3d34bcdd/)).toBeNull();
});

it.each([
  { locale: 'en', fallback: 'Unknown' },
  { locale: 'zh-Hant', fallback: '未知' },
] as const)(
  'should show the $locale fallback after a failed title read without identifiers',
  async ({ locale, fallback }) => {
    await renderMobile(
      <TitleProbe />,
      {
        get: async () => {
          throw new Error('Offline');
        },
      },
      savedLanguage(locale),
    );

    expect(await screen.findByText(fallback)).toBeVisible();
    expect(screen.queryByText(/3d34bcdd/)).toBeNull();
  },
);
