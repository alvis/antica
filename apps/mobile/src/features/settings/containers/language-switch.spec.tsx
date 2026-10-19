import { expect, it, jest } from '@jest/globals';
import { fireEvent, screen } from '@testing-library/react-native';

import { analysisRunDetailSchema } from '@antica/contracts';

import AnalysisRoute from '../../../app/(private)/analysis/[runId]';
import RecordRoute from '../../../app/(private)/collection/[recordId]';
import NewResearchRoute from '../../../app/(private)/research/new';
import {
  collectionRecord,
  renderMobile,
  savedLanguage,
} from '../../../mobile.spec.fixtures';
import { createReferencedRun } from '../../../saved-analysis.spec.fixtures';

import { media } from '../../media/containers/media.spec.fixtures';

import { LanguageSettingsContainer } from './LanguageSettingsContainer';

jest.mock('../../../providers/AuthProvider', () => ({ useAuth: jest.fn() }));
jest.mock(
  'expo-router',
  () =>
    ({
      useRouter: jest.fn<typeof import('expo-router').useRouter>(),
      useLocalSearchParams: jest.fn<
        typeof import('expo-router').useLocalSearchParams
      >(() => {
        const { collectionRecord } = jest.requireActual<
          typeof import('../../../mobile.spec.fixtures')
        >('../../../mobile.spec.fixtures');
        const { runId } = jest.requireActual<
          typeof import('../../../saved-analysis.spec.fixtures')
        >('../../../saved-analysis.spec.fixtures');

        return { recordId: collectionRecord.id, runId };
      }),
    }) satisfies Partial<typeof import('expo-router')>,
);
jest.mock('expo-crypto', () => ({
  randomUUID:
    jest.requireActual<typeof import('node:crypto')>('node:crypto').randomUUID,
}));

const referenced = createReferencedRun(media.asset.id);
const storedRun = analysisRunDetailSchema.parse({
  ...referenced,
  result: {
    ...referenced.result,
    output: {
      ...referenced.result.output,
      findings: referenced.result.output.findings.map((finding) => ({
        ...finding,
        text: '釉面開片細密，圈足露胎處有自然磨損。',
      })),
    },
  },
});
const storedRecord = {
  ...collectionRecord,
  name: '青花纏枝蓮紋碗',
  description: '碗心繪蓮花，口沿雙圈。',
  location: { locationId: null, detail: '書房櫃第二層' },
  dimensions: { height: { value: 8.4, unit: 'cm' } },
  latestRunId: storedRun.runId,
  analysisFreshness: 'current' as const,
};
/**
 * finds stored content, alone or inside an app-owned label
 * @param text stored content
 * @returns every element showing it unchanged
 */
function stored(text: string): unknown[] {
  return screen.queryAllByText(text, { exact: false });
}

const storedText = [
  '青花纏枝蓮紋碗',
  '碗心繪蓮花，口沿雙圈。',
  '書房櫃第二層',
  '釉面開片細密，圈足露胎處有自然磨損。',
];

it('should keep an unsaved research question when the interface language changes', async () => {
  await renderMobile(
    <>
      <NewResearchRoute />
      <LanguageSettingsContainer />
    </>,
    {},
    savedLanguage('zh-Hant'),
  );
  await fireEvent.changeText(
    screen.getByLabelText('研究問題'),
    '這種纏枝蓮紋流行於哪個時期？',
  );

  await fireEvent.press(screen.getByRole('radio', { name: 'English' }));
  await fireEvent.press(screen.getByRole('button', { name: '儲存' }));

  expect(screen.getByLabelText('Research question')).toHaveProp(
    'value',
    '這種纏枝蓮紋流行於哪個時期？',
  );
});

it('should change only app-owned copy, leaving stored content untouched and sending no request', async () => {
  const fetchSpy = jest.spyOn(globalThis, 'fetch');
  const view = await renderMobile(
    <>
      <RecordRoute />
      <AnalysisRoute />
      <LanguageSettingsContainer />
    </>,
    {
      get: async (path) =>
        path === `/v1/records/${storedRecord.id}`
          ? storedRecord
          : path === `/v1/analyses/${storedRun.runId}`
            ? storedRun
            : path === `/v1/media/${media.asset.id}`
              ? media
              : { items: [], nextCursor: null },
    },
    savedLanguage('zh-Hant'),
  );
  await screen.findAllByText('釉面開片細密，圈足露胎處有自然磨損。');
  await screen.findAllByText('青花纏枝蓮紋碗');
  for (const text of storedText) {
    expect(stored(text)).not.toHaveLength(0);
  }
  expect(screen.getByText('詳細位置')).toBeTruthy();
  const readsBefore = view.reads.mock.calls.length;
  const cachedBefore = view.client
    .getQueryCache()
    .getAll()
    .map((query) => [query.queryKey, query.state.dataUpdatedAt]);

  await fireEvent.press(screen.getByRole('radio', { name: 'English' }));
  await fireEvent.press(screen.getByRole('button', { name: '儲存' }));

  expect(screen.getByRole('header', { name: 'Language / 語言' })).toBeTruthy();
  // the stored location detail keeps its value beside a translated label
  expect(screen.getByText('Detailed location')).toBeTruthy();
  expect(screen.getByTestId('record-field-location-detail')).toHaveTextContent(
    '書房櫃第二層',
  );
  for (const text of storedText) {
    expect(stored(text)).not.toHaveLength(0);
  }
  expect(view.reads.mock.calls).toHaveLength(readsBefore);
  expect(view.commands).not.toHaveBeenCalled();
  expect(view.patches).not.toHaveBeenCalled();
  expect(fetchSpy).not.toHaveBeenCalled();
  expect(
    view.client
      .getQueryCache()
      .getAll()
      .map((query) => [query.queryKey, query.state.dataUpdatedAt]),
  ).toEqual(cachedBefore);
});
