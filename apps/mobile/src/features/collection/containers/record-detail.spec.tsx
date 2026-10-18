import { expect, it, jest } from '@jest/globals';
import {
  fireEvent,
  screen,
  waitFor,
  within,
} from '@testing-library/react-native';

import { useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { Linking } from 'react-native';

import { analysisRunDetailSchema } from '@antica/contracts';

import AnalysisRoute from '../../../app/(private)/analysis/[runId]';
import RecordRoute from '../../../app/(private)/collection/[recordId]';
import { useLocale } from '../../../i18n/LocaleProvider';
import { collectionRecord, renderMobile } from '../../../mobile.spec.fixtures';
import { createReferencedRun } from '../../../saved-analysis.spec.fixtures';

import { media } from '../../media/containers/media.spec.fixtures';

import {
  observationId,
  pageId,
  savedReferences,
  sourceId,
  sourceVersionId,
} from './record.spec.fixtures';

import type { FC, PropsWithChildren, ReactElement } from 'react';

import type { Locale } from '../../../i18n/messages';

/** requested locale and route content for the real locale provider */
export type InLocaleProps = PropsWithChildren<{ locale: Locale }>;

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
jest.mock(
  'expo-secure-store',
  () =>
    ({
      getItemAsync: jest.fn<typeof import('expo-secure-store').getItemAsync>(
        async () => null,
      ),
      setItemAsync: jest.fn<typeof import('expo-secure-store').setItemAsync>(
        async () => undefined,
      ),
    }) satisfies Partial<typeof import('expo-secure-store')>,
);

const photo = {
  ...media,
  asset: {
    ...media.asset,
    kind: 'photo' as const,
    originalFileName: 'bowl.jpg',
    mimeType: 'image/jpeg',
  },
};

const mixed = createReferencedRun(media.asset.id);
const savedRun = analysisRunDetailSchema.parse({
  ...mixed,
  result: {
    ...mixed.result,
    output: {
      ...mixed.result.output,
      proposedChanges: mixed.result.output.proposedChanges.map(
        (change, index) => ({
          ...change,
          findingIds: index === 0 ? [mixed.result.output.findings[0].id] : [],
        }),
      ),
    },
  },
});
const record = {
  ...collectionRecord,
  latestRunId: savedRun.runId,
  analysisFreshness: 'current' as const,
};
const responses: Parameters<typeof renderMobile>[1] = {
  get: async (path: string) =>
    path === `/v1/records/${record.id}`
      ? record
      : path === `/v1/analyses/${savedRun.runId}`
        ? savedRun
        : path === `/v1/media/${media.asset.id}`
          ? media
          : { items: [], nextCursor: null },
};

/**
 * waits for the real locale action before mounting the requested route
 * @param root0 requested locale and route
 * @param root0.locale requested UI locale
 * @param root0.children route to mount once the locale is active
 * @returns route content when the real provider has the requested locale
 */
const InLocale: FC<InLocaleProps> = ({
  locale,
  children,
}): ReactElement | null => {
  const { locale: currentLocale, setLocale } = useLocale();
  useEffect(() => {
    if (currentLocale !== locale) {
      void setLocale(locale);
    }
  }, [currentLocale, locale, setLocale]);

  return currentLocale === locale ? <>{children}</> : null;
};

/**
 * verifies authored name content remains associated with the selected field
 * @param proposal name proposal checkbox
 * @param labels active locale labels
 * @param labels.previous previous-value label
 * @param labels.proposed proposed-value label
 */
function expectNameContent(
  proposal: Parameters<typeof within>[0],
  labels: { previous: string; proposed: string },
): void {
  expect(within(proposal).getByText(`${labels.previous}: null`)).toBeTruthy();
  expect(
    within(proposal).getByText(`${labels.proposed}: "Blue vase"`),
  ).toBeTruthy();
  expect(
    within(proposal).getByText('Mixed supporting references'),
  ).toBeTruthy();
}

it.each([
  {
    locale: 'en' as const,
    results: 'Results',
    name: 'Name',
    description: 'Description',
    previous: 'Previous',
    proposed: 'Proposed',
    apply: 'Apply selected changes',
  },
  {
    locale: 'zh-Hant' as const,
    results: '結果',
    name: '名稱',
    description: '描述',
    previous: '目前內容',
    proposed: '建議內容',
    apply: '套用所選變更',
  },
])(
  'should reopen saved proposals in $locale and select without writing',
  async (labels) => {
    const recordView = await renderMobile(
      <InLocale locale={labels.locale}>
        <RecordRoute />
      </InLocale>,
      responses,
    );
    await fireEvent.press(
      await screen.findByRole('button', { name: labels.results }),
    );
    expect(recordView.router.push).toHaveBeenCalledWith(
      `/analysis/${savedRun.runId}`,
    );
    expect(recordView.commands).not.toHaveBeenCalled();
    expect(recordView.patches).not.toHaveBeenCalled();
    await screen.unmount();

    const analysisView = await renderMobile(
      <InLocale locale={labels.locale}>
        <AnalysisRoute />
      </InLocale>,
      responses,
    );
    const nameProposal = await screen.findByRole('checkbox', {
      name: new RegExp(labels.name),
    });
    const descriptionProposal = screen.getByRole('checkbox', {
      name: new RegExp(labels.description),
    });
    expectNameContent(nameProposal, labels);
    expect(
      within(descriptionProposal).getByText(`${labels.previous}: ""`),
    ).toBeTruthy();
    expect(
      within(descriptionProposal).getByText(
        `${labels.proposed}: "Floral decoration"`,
      ),
    ).toBeTruthy();
    expect(
      within(descriptionProposal).queryByText('Mixed supporting references'),
    ).toBeNull();
    expect(nameProposal).not.toBeChecked();
    expect(descriptionProposal).not.toBeChecked();
    const applyButton = screen.getByRole('button', {
      name: new RegExp(labels.apply),
    });
    expect(applyButton).toBeDisabled();

    await fireEvent.press(nameProposal);
    expect(nameProposal).toBeChecked();
    expect(descriptionProposal).not.toBeChecked();
    expect(applyButton).toBeEnabled();
    await fireEvent.press(nameProposal);
    expect(nameProposal).not.toBeChecked();
    expect(applyButton).toBeDisabled();
    expectNameContent(nameProposal, labels);
    expect(analysisView.commands).not.toHaveBeenCalled();
    expect(analysisView.patches).not.toHaveBeenCalled();
  },
);

it('should show a record, open capture, and save trimmed edits against its revision', async () => {
  jest
    .mocked(useLocalSearchParams)
    .mockReturnValue({ recordId: collectionRecord.id });
  const view = await renderMobile(<RecordRoute />, {
    get: async (path) =>
      path === `/v1/records/${collectionRecord.id}`
        ? collectionRecord
        : { items: [], nextCursor: null },
  });
  await waitFor(() => expect(screen.getAllByText('A-001')).toHaveLength(2));
  expect(screen.getByRole('button', { name: 'Analyze' })).toBeDisabled();
  expect(screen.getByText('Not analyzed')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Add evidence' }));
  expect(view.router.push).toHaveBeenCalledWith(
    `/capture?recordId=${collectionRecord.id}`,
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Edit' }));
  await fireEvent.changeText(screen.getByLabelText('Name'), '  Blue bowl  ');
  await fireEvent.changeText(
    screen.getByLabelText('Description'),
    'Blue glaze',
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(view.patches).toHaveBeenCalledTimes(1));
  expect(view.patches.mock.calls[0]).toEqual([
    `/v1/records/${collectionRecord.id}`,
    expect.anything(),
    expect.objectContaining({
      body: {
        expectedRevision: 1,
        fields: { name: 'Blue bowl', description: 'Blue glaze' },
      },
    }),
  ]);
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy(),
  );
});

it('should start analysis explicitly and keep the check context on a signed photo', async () => {
  const checkId = '00000000-0000-4000-8000-000000000051';
  const runId = '00000000-0000-4000-8000-000000000052';
  jest.mocked(useLocalSearchParams).mockReturnValue({
    recordId: collectionRecord.id,
    checkId,
  });
  const record = {
    ...collectionRecord,
    mediaIds: [photo.asset.id],
    checkIds: [checkId],
    latestRunId: runId,
    analysisFreshness: 'outdated' as const,
    recordRevision: 4,
  };
  const view = await renderMobile(<RecordRoute />, {
    get: async (path) =>
      path === `/v1/records/${collectionRecord.id}`
        ? record
        : path === `/v1/media/${photo.asset.id}`
          ? photo
          : { items: [], nextCursor: null },
    post: async () => ({ runId, jobId: runId }),
  });
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Analyze again' })).toBeEnabled(),
  );
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Find similar images' }),
    ).toBeTruthy(),
  );
  expect(screen.getByLabelText('bowl.jpg')).toHaveProp('source', {
    uri: media.reads[0].url,
  });
  expect(screen.getByText('New evidence not analyzed')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'View' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Results' }));
  await fireEvent.press(screen.getByRole('button', { name: /^Checks / }));
  expect(jest.mocked(view.router.push).mock.calls).toEqual([
    [`/media/${photo.asset.id}?checkId=${checkId}`],
    [`/analysis/${runId}`],
    [`/checks/${checkId}`],
  ]);
  await fireEvent.press(screen.getByRole('button', { name: 'Analyze again' }));
  await waitFor(() => expect(view.commands).toHaveBeenCalledTimes(1));
  expect(view.commands.mock.calls[0]).toEqual([
    `/v1/records/${collectionRecord.id}/analyses`,
    expect.anything(),
    expect.objectContaining({ body: { expectedRecordRevision: 4 } }),
  ]);
  expect(view.router.push).toHaveBeenCalledWith(`/analysis/${runId}`);
});

it('should create a whole-photo evidence anchor before opening similar-image research', async () => {
  jest
    .mocked(useLocalSearchParams)
    .mockReturnValue({ recordId: collectionRecord.id });
  const view = await renderMobile(<RecordRoute />, {
    get: async (path) =>
      path === `/v1/records/${collectionRecord.id}`
        ? { ...collectionRecord, mediaIds: [photo.asset.id] }
        : path === `/v1/media/${photo.asset.id}`
          ? photo
          : { items: [], nextCursor: null },
    post: async () => ({
      id: '00000000-0000-4000-8000-000000000053',
      kind: 'image',
      recordId: collectionRecord.id,
      componentIds: [],
      originalAssetId: photo.asset.id,
      canonicalViewId: photo.asset.views[0].id,
      scope: { kind: 'whole' },
      createdAt: collectionRecord.createdAt,
    }),
  });
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Find similar images' }),
    ).toBeTruthy(),
  );
  await fireEvent.press(
    screen.getByRole('button', { name: 'Find similar images' }),
  );
  await waitFor(() => expect(view.commands).toHaveBeenCalledTimes(1));
  const request = view.commands.mock.calls[0][2];
  expect(request.body).toEqual({
    requestKey: request.idempotencyKey,
    mode: 'create',
    evidence: {
      kind: 'image',
      recordId: collectionRecord.id,
      componentIds: [],
      originalAssetId: photo.asset.id,
      canonicalViewId: photo.asset.views[0].id,
      scope: { kind: 'whole' },
    },
  });
  expect(view.router.push).toHaveBeenCalledWith(
    `/research/similar?anchorId=00000000-0000-4000-8000-000000000053&recordId=${collectionRecord.id}&assetId=${photo.asset.id}&viewId=${photo.asset.views[0].id}`,
  );
});

it('should keep the collector on the record while image evidence processes or fails', async () => {
  jest
    .mocked(useLocalSearchParams)
    .mockReturnValue({ recordId: collectionRecord.id });
  const view = await renderMobile(<RecordRoute />, {
    get: async (path) =>
      path === `/v1/records/${collectionRecord.id}`
        ? { ...collectionRecord, mediaIds: [photo.asset.id] }
        : path === `/v1/media/${photo.asset.id}`
          ? photo
          : { items: [], nextCursor: null },
  });
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Find similar images' }),
    ).toBeTruthy(),
  );
  view.commands.mockResolvedValueOnce({ kind: 'job' });
  view.commands.mockRejectedValueOnce(new Error('Offline'));
  await fireEvent.press(
    screen.getByRole('button', { name: 'Find similar images' }),
  );
  await waitFor(() =>
    expect(screen.getByRole('alert')).toHaveTextContent('Processing'),
  );
  await fireEvent.press(
    screen.getByRole('button', { name: 'Find similar images' }),
  );
  await waitFor(() =>
    expect(screen.getByRole('alert')).toHaveTextContent('Offline'),
  );
  expect(view.router.push).not.toHaveBeenCalled();
});

it('should reopen observations, video, and saved collection, page, and web references', async () => {
  jest.mocked(useLocalSearchParams).mockReturnValue({
    recordId: collectionRecord.id,
    observationId,
  });
  const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
  const view = await renderMobile(<RecordRoute />, {
    get: async (path) =>
      path === `/v1/records/${collectionRecord.id}`
        ? {
            ...collectionRecord,
            name: 'Blue bowl',
            description: 'Blue glaze',
            location: { locationId: null, detail: 'Cabinet' },
            mediaIds: [media.asset.id],
            analysisFreshness: 'current',
          }
        : path === `/v1/media/${media.asset.id}`
          ? media
          : path.endsWith('/observations')
            ? {
                items: [
                  { id: observationId, text: 'Blue decoration' },
                  {
                    id: '00000000-0000-4000-8000-000000000061',
                    text: 'Base mark',
                  },
                ],
                nextCursor: null,
              }
            : { items: savedReferences, nextCursor: null },
  });
  await waitFor(() => expect(screen.getByText('Blue decoration')).toBeTruthy());
  expect(
    screen.getByRole('text', {
      name: 'Referenced observation: Blue decoration',
      selected: true,
    }),
  ).toBeTruthy();
  expect(screen.getByText('Referenced observation')).toBeTruthy();
  expect(
    screen.queryByLabelText('Referenced observation: Base mark'),
  ).toBeNull();
  await waitFor(() =>
    expect(screen.getAllByRole('button', { name: 'View source' })).toHaveLength(
      savedReferences.length,
    ),
  );
  expect(screen.getByText('Blue glaze')).toBeTruthy();
  expect(screen.getByText('Saved')).toBeTruthy();
  expect(screen.getByText('collection')).toBeTruthy();
  expect(
    screen.queryByRole('button', { name: 'Find similar images' }),
  ).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: 'View' }));
  for (const button of screen.getAllByRole('button', { name: 'View source' })) {
    await fireEvent.press(button);
  }
  expect(jest.mocked(view.router.push).mock.calls).toEqual([
    [`/media/${media.asset.id}`],
    [`/media/${media.asset.id}`],
    [`/sources/${sourceId}?versionId=${sourceVersionId}&pageId=${pageId}`],
  ]);
  expect(openURL).toHaveBeenCalledWith('https://museum.example/bowl');
});

it('should show failed analysis and stale edit without discarding the edit', async () => {
  jest
    .mocked(useLocalSearchParams)
    .mockReturnValue({ recordId: collectionRecord.id });
  const view = await renderMobile(<RecordRoute />, {
    get: async (path) =>
      path === `/v1/records/${collectionRecord.id}`
        ? { ...collectionRecord, mediaIds: [photo.asset.id] }
        : path === `/v1/media/${photo.asset.id}`
          ? photo
          : { items: [], nextCursor: null },
  });
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Analyze' })).toBeEnabled(),
  );
  view.commands.mockRejectedValueOnce(new Error('Analysis unavailable'));
  await fireEvent.press(screen.getByRole('button', { name: 'Analyze' }));
  await waitFor(() =>
    expect(screen.getByRole('alert')).toHaveTextContent('Analysis unavailable'),
  );
  expect(view.router.push).not.toHaveBeenCalled();

  await fireEvent.press(screen.getByRole('button', { name: 'Edit' }));
  await fireEvent.changeText(screen.getByLabelText('Name'), '   ');
  view.patches.mockRejectedValueOnce(new Error('Revision changed'));
  await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() =>
    expect(screen.getByRole('alert')).toHaveTextContent('Revision changed'),
  );
  expect(view.patches.mock.calls[0][2].body).toEqual({
    expectedRevision: 1,
    fields: { name: null, description: '' },
  });
  expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy();
});

it('should retry a failed record read and restore its actions', async () => {
  jest
    .mocked(useLocalSearchParams)
    .mockReturnValue({ recordId: collectionRecord.id });
  const readRecord = jest
    .fn<() => Promise<unknown>>()
    .mockRejectedValueOnce(new Error('Offline'))
    .mockResolvedValue(collectionRecord);
  const view = await renderMobile(<RecordRoute />, {
    get: async (path) =>
      path === `/v1/records/${collectionRecord.id}`
        ? readRecord()
        : { items: [], nextCursor: null },
  });
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy(),
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Retry' }));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy(),
  );
  expect(
    view.reads.mock.calls.filter(
      ([path]) => path === `/v1/records/${collectionRecord.id}`,
    ),
  ).toHaveLength(2);
});

it('should report a saved web reference that cannot be opened', async () => {
  jest
    .mocked(useLocalSearchParams)
    .mockReturnValue({ recordId: collectionRecord.id });
  jest
    .spyOn(Linking, 'openURL')
    .mockRejectedValue(new Error('Link unavailable'));
  const view = await renderMobile(<RecordRoute />, {
    get: async (path) =>
      path === `/v1/records/${collectionRecord.id}`
        ? collectionRecord
        : path.endsWith('/references')
          ? {
              items: [
                {
                  id: '00000000-0000-4000-8000-000000000062',
                  noteZhHant: 'Museum site',
                  reference: {
                    kind: 'source',
                    referenceImageId: null,
                    locator: {
                      kind: 'web',
                      sourceId: '00000000-0000-4000-8000-000000000063',
                      sourceVersionId: '00000000-0000-4000-8000-000000000064',
                      url: 'https://museum.example/bowl',
                    },
                  },
                },
              ],
              nextCursor: null,
            }
          : { items: [], nextCursor: null },
  });
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'View source' })).toBeTruthy(),
  );
  await fireEvent.press(screen.getByRole('button', { name: 'View source' }));
  await waitFor(() =>
    expect(screen.getByRole('alert')).toHaveTextContent('Link unavailable'),
  );
  expect(view.router.push).not.toHaveBeenCalled();
});

it('should open the record’s change history', async () => {
  const view = await renderMobile(<RecordRoute />, responses);

  await fireEvent.press(await screen.findByTestId('record-open-history'));

  expect(view.router.push).toHaveBeenCalledWith(
    `/collection/${record.id}/history`,
  );
});
