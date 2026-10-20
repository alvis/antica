import { expect, it, jest } from '@jest/globals';
import { fireEvent, screen } from '@testing-library/react-native';

import {
  collectionRecord,
  renderMobile,
} from '../../../../mobile.spec.fixtures';
import {
  relatedAttachment,
  relatedCard,
  relatedPage,
  relatedPath,
} from '../../../knowledge/containers/related-knowledge.spec.fixtures';

import {
  historicalAnswer as answer,
  historicalClaimId as claimId,
} from './record-messages-knowledge.spec.fixtures';
import { page, recordId } from './record-messages.spec.fixtures';
import { RecordMessagesContainer } from './RecordMessagesContainer';

jest.mock(
  '../../../../providers/AuthProvider',
  () =>
    ({
      useAuth:
        jest.fn<typeof import('../../../../providers/AuthProvider').useAuth>(),
    }) satisfies Partial<typeof import('../../../../providers/AuthProvider')>,
);
jest.mock(
  'expo-router',
  () =>
    ({
      useRouter: jest.fn<typeof import('expo-router').useRouter>(),
      useLocalSearchParams: jest.fn<
        typeof import('expo-router').useLocalSearchParams
      >(() => ({ recordId: '00000000-0000-4000-8000-000000000001' })),
    }) satisfies Partial<typeof import('expo-router')>,
);
jest.mock(
  'expo-crypto',
  () =>
    ({
      randomUUID:
        jest.requireActual<typeof import('node:crypto')>('node:crypto')
          .randomUUID,
    }) satisfies Partial<typeof import('expo-crypto')>,
);
jest.mock(
  'expo-secure-store',
  () =>
    ({
      getItemAsync: jest.fn(async () => null),
      setItemAsync: jest.fn(async () => undefined),
    }) satisfies Partial<typeof import('expo-secure-store')>,
);
jest.mock('expo-audio', () => {
  const recorder = {
    uri: 'file:///voice-message.m4a' as string | null,
    prepareToRecordAsync: async () => undefined,
    record: () => undefined,
    stop: async () => undefined,
  };

  return {
    useAudioRecorder: () => recorder,
    requestRecordingPermissionsAsync: jest.fn(async () => ({ granted: true })),
    setAudioModeAsync: jest.fn(async () => undefined),
    RecordingPresets: { HIGH_QUALITY: {} },
    recorder,
  };
});
jest.mock(
  '../../../../adapters/media-upload',
  () =>
    ({
      uploadMedia:
        jest.fn<
          typeof import('../../../../adapters/media-upload').uploadMedia
        >(),
    }) satisfies Partial<typeof import('../../../../adapters/media-upload')>,
);

it('should render frozen historical citations and omit an answer-only edit card without fetching newer knowledge', async () => {
  const view = await renderMobile(
    <RecordMessagesContainer recordId={recordId} />,
    {
      relatedKnowledge: async () => relatedPage,
      get: async (path) =>
        path.startsWith(relatedPath)
          ? relatedPage
          : path === `/v1/records/${recordId}`
            ? collectionRecord
            : page([answer]),
    },
  );

  const evidence = await screen.findByTestId(
    `record-message-knowledge-${answer.id}-${claimId}`,
  );
  expect(evidence).toHaveTextContent(/Historical dark finish/);
  expect(evidence).toHaveTextContent(/Qing/);
  expect(evidence).toHaveTextContent(/Daylight/);
  expect(evidence).toHaveTextContent(/Later finish may affect appearance/);
  expect(
    screen.queryByTestId(`record-message-card-${answer.editDraftId}`),
  ).toBeNull();
  expect(
    view.reads.mock.calls.some(([path]) => path.startsWith('/v1/knowledge/')),
  ).toBe(false);
  await fireEvent.press(
    screen.getByTestId(
      `record-message-knowledge-open-${answer.id}-${relatedCard.entryId}`,
    ),
  );
  expect(view.router.push).toHaveBeenCalledWith(
    `/knowledge/${relatedCard.entryId}?view=revision&revision=2`,
  );
});

it('should open and close frozen source metadata without reading current evidence', async () => {
  const view = await renderMobile(
    <RecordMessagesContainer recordId={recordId} />,
    {
      relatedKnowledge: async () => relatedPage,
      get: async (path) =>
        path.startsWith(relatedPath)
          ? relatedPage
          : path === `/v1/records/${recordId}`
            ? collectionRecord
            : page([answer]),
    },
  );
  await fireEvent.press(
    await screen.findByTestId(
      `record-message-knowledge-citation-${answer.id}-surface-${relatedAttachment.citationIds[0]}`,
    ),
  );

  const panel = await screen.findByTestId(
    `knowledge-citation-panel-${relatedAttachment.citationIds[0]}`,
  );
  expect(panel).toHaveTextContent(/Archived museum record/);
  expect(panel).toHaveTextContent(/Museum archive/);
  expect(panel).toHaveTextContent(/The original captured quote/);
  expect(panel).toHaveTextContent(/00000000-0000-4000-8000-000000000066/);
  await fireEvent.press(screen.getByRole('button', { name: 'Close' }));
  expect(
    screen.queryByTestId(
      `knowledge-citation-panel-${relatedAttachment.citationIds[0]}`,
    ),
  ).toBeNull();
  expect(
    view.reads.mock.calls.some(([path]) => path.startsWith('/v1/knowledge/')),
  ).toBe(false);
});

it('should show only the citations referenced by answer segments', async () => {
  const unusedCitationId = '00000000-0000-4000-8000-000000000079';
  const evidence = {
    ...answer,
    answerSegments: [
      {
        text: 'Supported answer',
        evidenceRefs: [{ ...relatedAttachment, revision: 2 }],
      },
    ],
    knowledgeEvidence: {
      ...answer.knowledgeEvidence,
      entries: answer.knowledgeEvidence.entries.map((saved) => ({
        ...saved,
        claims: saved.claims.flatMap((claim) => [
          {
            ...claim,
            citations: [
              ...claim.citations,
              ...claim.citations.map((citation) => ({
                ...citation,
                citationId: unusedCitationId,
                sourceTitle: 'Unused source',
              })),
            ],
          },
          {
            ...claim,
            claimKey: 'unused-claim',
            claimId: unusedCitationId,
            statement: 'Unused statement',
          },
        ]),
      })),
    },
  };
  await renderMobile(<RecordMessagesContainer recordId={recordId} />, {
    relatedKnowledge: async () => relatedPage,
    get: async (path) =>
      path.startsWith(relatedPath)
        ? relatedPage
        : path === `/v1/records/${recordId}`
          ? collectionRecord
          : page([evidence]),
  });

  expect(
    await screen.findByTestId(
      `record-message-knowledge-citation-${answer.id}-surface-${relatedAttachment.citationIds[0]}`,
    ),
  ).toBeVisible();
  expect(screen.queryByText('Unused statement')).toBeNull();
  expect(
    screen.queryByTestId(
      `record-message-knowledge-citation-${answer.id}-surface-${unusedCitationId}`,
    ),
  ).toBeNull();
});

it('should omit frozen claims that the answer does not cite', async () => {
  await renderMobile(<RecordMessagesContainer recordId={recordId} />, {
    relatedKnowledge: async () => relatedPage,
    get: async (path) =>
      path.startsWith(relatedPath)
        ? relatedPage
        : path === `/v1/records/${recordId}`
          ? collectionRecord
          : page([
              {
                ...answer,
                answerSegments: [
                  { text: 'No supported facts', evidenceRefs: [] },
                ],
              },
            ]),
  });

  await screen.findByText(answer.body);
  expect(screen.queryByText('Historical catalogue title')).toBeNull();
  expect(
    screen.queryByTestId(`record-message-knowledge-${answer.id}-${claimId}`),
  ).toBeNull();
});

it('should preserve legacy answer-only history with no evidence', async () => {
  await renderMobile(<RecordMessagesContainer recordId={recordId} />, {
    relatedKnowledge: async () => relatedPage,
    get: async (path) =>
      path.startsWith(relatedPath)
        ? relatedPage
        : path === `/v1/records/${recordId}`
          ? collectionRecord
          : page([{ ...answer, knowledgeEvidence: [] }]),
  });

  expect(await screen.findByText(answer.body)).toBeVisible();
  expect(screen.queryByText('Historical catalogue title')).toBeNull();
  expect(
    screen.queryByTestId(`record-message-card-${answer.editDraftId}`),
  ).toBeNull();
});
