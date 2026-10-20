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

import { analysisRunDetailSchema, recordDetailSchema } from '@antica/contracts';

import AnalysisRoute from '../../../app/(private)/analysis/[runId]';
import RecordRoute from '../../../app/(private)/collection/[recordId]';
import { collectionRecord, renderMobile } from '../../../mobile.spec.fixtures';
import {
  useInterfaceLanguage,
  useLocale,
} from '../../../providers/LocaleProvider';
import { createReferencedRun } from '../../../saved-analysis.spec.fixtures';

import { media } from '../../media/containers/media.spec.fixtures';

import { setRecordEditNotice } from '../api/record-edit-notice';
import {
  filledRecord,
  knowledgeDetail,
  locations,
  materialId,
  receipt,
} from '../record-edit.spec.fixtures';

import {
  hubReads,
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
      useFocusEffect: jest.fn<typeof import('expo-router').useFocusEffect>(),
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
          : hubReads(path),
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
  const { locale: currentLocale } = useLocale();
  const { save } = useInterfaceLanguage();
  useEffect(() => {
    if (currentLocale !== locale) {
      void save(locale);
    }
  }, [currentLocale, locale, save]);

  return currentLocale === locale ? <>{children}</> : null;
};

/** a rendered element as the host tree exposes it */
interface HostNode {
  readonly props: { readonly source?: unknown };
  readonly children: ReadonlyArray<HostNode | string>;
}

/**
 * collects the image sources drawn inside an element, such as a carousel page's signed photo
 * @param node rendered element
 * @returns every image source beneath it
 */
function imageSources(node: HostNode): unknown[] {
  return [
    ...(node.props.source === undefined ? [] : [node.props.source]),
    ...node.children.flatMap((child) =>
      typeof child === 'string' ? [] : imageSources(child),
    ),
  ];
}

/**
 * verifies authored name content remains associated with the selected field
 * @param proposal name proposal checkbox
 * @param labels active locale labels
 * @param labels.previous previous-value label
 * @param labels.proposed proposed-value label
 * @param labels.empty shown for an empty value
 */
function expectNameContent(
  proposal: Parameters<typeof within>[0],
  labels: { previous: string; proposed: string; empty: string },
): void {
  expect(within(proposal).getByText(labels.previous)).toBeTruthy();
  expect(within(proposal).getByText(labels.empty)).toBeTruthy();
  expect(within(proposal).getByText(labels.proposed)).toBeTruthy();
  expect(within(proposal).getByText('Blue vase')).toBeTruthy();
  expect(
    within(proposal).getByText('Mixed supporting references'),
  ).toBeTruthy();
}

it.each([
  {
    locale: 'en' as const,
    results: /^Review 2 suggestions$/,
    name: 'Name',
    description: 'Description',
    previous: 'Previous',
    proposed: 'Proposed',
    empty: '(empty)',
    apply: 'Apply selected changes',
  },
  {
    locale: 'zh-Hant' as const,
    results: /^檢閱 2 項建議$/,
    name: '名稱',
    description: '描述',
    previous: '目前內容',
    proposed: '建議內容',
    empty: '（空白）',
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
    // the hub puts the waiting suggestions first; opening them writes nothing
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
    // an empty description reads as empty rather than as quotes
    expect(within(descriptionProposal).getByText(labels.empty)).toBeTruthy();
    expect(
      within(descriptionProposal).getByText('Floral decoration'),
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

it('should show a record, open capture, and open the manual editor', async () => {
  jest
    .mocked(useLocalSearchParams)
    .mockReturnValue({ recordId: collectionRecord.id });
  const view = await renderMobile(<RecordRoute />, {
    get: async (path) =>
      path === `/v1/records/${collectionRecord.id}`
        ? collectionRecord
        : hubReads(path),
  });
  expect(await screen.findByRole('header', { name: 'A-001' })).toBeTruthy();
  // without a photo there is nothing to analyse yet
  expect(screen.getByRole('button', { name: 'Start analysis' })).toBeDisabled();
  expect(screen.getByTestId('record-analysis-status-unanalysed')).toBeTruthy();
  expect(
    screen.getByText('Saved. You can start an analysis at any time.'),
  ).toBeTruthy();
  // capture lives under 查驗, as in the design, while that segment is a placeholder
  await fireEvent.press(screen.getByTestId('record-segment-checks'));
  await fireEvent.press(screen.getByRole('button', { name: 'Add evidence' }));
  expect(view.router.push).toHaveBeenCalledWith(
    `/capture?recordId=${collectionRecord.id}`,
  );
  await fireEvent.press(screen.getByTestId('record-segment-data'));
  await fireEvent.press(screen.getByRole('button', { name: 'Edit' }));
  expect(view.router.push).toHaveBeenLastCalledWith(
    `/collection/${collectionRecord.id}/edit`,
  );
  expect(view.patches).not.toHaveBeenCalled();
});

it('should show the key details first and every known detail on request, with labels', async () => {
  jest
    .mocked(useLocalSearchParams)
    .mockReturnValue({ recordId: filledRecord.id });
  await renderMobile(<RecordRoute />, {
    get: async (path) =>
      path === `/v1/records/${filledRecord.id}`
        ? filledRecord
        : path === '/v1/locations'
          ? locations
          : path.startsWith('/v1/knowledge/')
            ? knowledgeDetail(materialId, 'Porcelain')
            : path.startsWith('/v1/media/')
              ? receipt
              : hubReads(path),
  });

  const details = await screen.findByTestId('record-collection-data');
  await waitFor(() =>
    expect(
      within(details).getByTestId('record-field-location-id'),
    ).toHaveTextContent('Main display-room cabinet'),
  );
  expect(
    within(details).getByTestId('record-field-location-detail'),
  ).toHaveTextContent('Second shelf');
  // the size tile leads with the diameter, the measure a round piece is known by
  expect(screen.getByTestId('record-fact-size')).toHaveTextContent(
    'SizeDiameter 160 mm',
  );
  expect(within(details).getByText('Notes')).toBeTruthy();
  // the rest waits behind the toggle (B06)
  expect(screen.queryByTestId('record-field-purchase')).toBeNull();
  expect(screen.queryByTestId('record-field-height')).toBeNull();
  const toggle = screen.getByTestId('record-fields-toggle');
  expect(toggle).toHaveTextContent('Show all details');
  expect(toggle).toHaveProp('accessibilityState', { expanded: false });

  await fireEvent.press(toggle);

  expect(
    within(details).getByTestId('record-field-purchase'),
  ).toHaveTextContent('1200 HKD');
  expect(within(details).getByTestId('record-field-height')).toHaveTextContent(
    '8.4 cm',
  );
  await waitFor(() =>
    expect(
      within(details).getByTestId('record-field-material-ids'),
    ).toHaveTextContent('Porcelain'),
  );
  expect(within(details).queryByTestId('record-field-name')).toBeNull();
  expect(toggle).toHaveTextContent('Show fewer details');
  await fireEvent.press(toggle);
  expect(within(details).queryByTestId('record-field-purchase')).toBeNull();
});

it('should leave unknown details out instead of filling them in', async () => {
  jest
    .mocked(useLocalSearchParams)
    .mockReturnValue({ recordId: collectionRecord.id });
  await renderMobile(<RecordRoute />, {
    get: async (path) =>
      path === `/v1/records/${collectionRecord.id}`
        ? recordDetailSchema.parse({
            ...collectionRecord,
            pieceCount: null,
            description: '',
            dimensions: {},
            location: { locationId: null, detail: '' },
          })
        : hubReads(path),
  });

  const facts = await screen.findByTestId('record-fields');
  // each unknown fact reads as not filled in rather than guessed
  for (const fact of ['period', 'material', 'size', 'tags']) {
    expect(within(facts).getByTestId(`record-fact-${fact}`)).toHaveTextContent(
      /Not filled in$/,
    );
  }
  const details = screen.getByTestId('record-collection-data');
  expect(within(details).queryByTestId('record-field-location-id')).toBeNull();
  expect(within(details).queryByTestId('record-field-description')).toBeNull();
  // with no other known detail there is nothing more to show
  expect(screen.queryByTestId('record-fields-toggle')).toBeNull();
});

it('should tell the collector once that a save landed on a refreshed record', async () => {
  jest
    .mocked(useLocalSearchParams)
    .mockReturnValue({ recordId: collectionRecord.id });
  const view = await renderMobile(<RecordRoute />, {
    get: async (path) =>
      path === `/v1/records/${collectionRecord.id}`
        ? collectionRecord
        : hubReads(path),
  });
  setRecordEditNotice(view.client, collectionRecord.id, 'refreshed');

  expect(await screen.findByTestId('record-edit-refreshed')).toHaveProp(
    'accessibilityRole',
    'alert',
  );
  await fireEvent.press(screen.getByTestId('record-edit-refreshed-dismiss'));
  await waitFor(() =>
    expect(screen.queryByTestId('record-edit-refreshed')).toBeNull(),
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
          : hubReads(path),
    post: async () => ({ runId, jobId: runId }),
  });
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Analyze again' })).toBeEnabled(),
  );
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Find similar' })).toBeTruthy(),
  );
  const page = screen.getByTestId(`record-media-${photo.asset.id}-ready`);
  expect(page).toHaveProp('accessibilityLabel', 'bowl, photo 1 of 1');
  expect(imageSources(page)).toEqual([{ uri: media.reads[0].url }]);
  expect(screen.getByTestId('record-analysis-status-outdated')).toBeTruthy();
  await fireEvent.press(page);
  await fireEvent.press(screen.getByRole('link', { name: 'Suggestions' }));
  await fireEvent.press(screen.getByRole('tab', { name: 'Checks' }));
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
          : hubReads(path),
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
    expect(screen.getByRole('button', { name: 'Find similar' })).toBeTruthy(),
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Find similar' }));
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
          : hubReads(path),
  });
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Find similar' })).toBeTruthy(),
  );
  view.commands.mockResolvedValueOnce({ kind: 'job' });
  view.commands.mockRejectedValueOnce(new Error('Offline'));
  await fireEvent.press(screen.getByRole('button', { name: 'Find similar' }));
  await waitFor(() =>
    expect(screen.getByRole('alert')).toHaveTextContent('Processing'),
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Find similar' }));
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
            : path.endsWith('/references')
              ? { items: savedReferences, nextCursor: null }
              : hubReads(path),
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
  expect(screen.getByTestId('record-field-description')).toHaveTextContent(
    'Blue glaze',
  );
  expect(screen.getByText('collection')).toBeTruthy();
  // a video has no still to search with
  expect(screen.queryByTestId('record-find-similar')).toBeNull();
  await fireEvent.press(
    screen.getByTestId(`record-media-${media.asset.id}-${media.asset.state}`),
  );
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

it('should keep a failed analysis start beside its action', async () => {
  jest
    .mocked(useLocalSearchParams)
    .mockReturnValue({ recordId: collectionRecord.id });
  const view = await renderMobile(<RecordRoute />, {
    get: async (path) =>
      path === `/v1/records/${collectionRecord.id}`
        ? { ...collectionRecord, mediaIds: [photo.asset.id] }
        : path === `/v1/media/${photo.asset.id}`
          ? photo
          : hubReads(path),
  });
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Start analysis' }),
    ).toBeEnabled(),
  );
  view.commands.mockRejectedValueOnce(new Error('Analysis unavailable'));
  await fireEvent.press(screen.getByRole('button', { name: 'Start analysis' }));
  await waitFor(() =>
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Something went wrong.',
    ),
  );
  expect(view.router.push).not.toHaveBeenCalled();

  expect(screen.getByTestId('record-analyse-error')).toHaveTextContent(
    'Something went wrong.',
  );
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
        : hubReads(path),
  });
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy(),
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Retry' }));
  await waitFor(() => expect(screen.getByTestId('record-edit')).toBeTruthy());
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
          : hubReads(path),
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
