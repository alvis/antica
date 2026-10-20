import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import { Pressable, Text } from 'react-native';

import { Screen } from '../../../components/Screen';
import {
  collectorId,
  renderMobile,
  savedLanguage,
} from '../../../mobile.spec.fixtures';
import {
  AskAssistantProvider,
  useAskAssistant,
} from '../../../providers/AskAssistantProvider';
import { useAuth } from '../../../providers/AuthProvider';

import { AskSheetContainer } from './AskSheetContainer';

import type { ReactElement } from 'react';

import type { KnowledgeSearchPage } from '@antica/contracts';

import type { AskContext } from '../ask-context';

jest.mock('../../../providers/AuthProvider', () => ({ useAuth: jest.fn() }));
jest.mock(
  'expo-router',
  () =>
    ({
      useRouter: jest.fn<typeof import('expo-router').useRouter>(),
    }) satisfies Partial<typeof import('expo-router')>,
);

const entryId = '0b7a1f5e-2c4d-4e8f-9a1b-3c5d7e9f1a2b';
const sha256Length = 64;

/** one saved Ru-ware entry whose excerpt the answer quotes */
const ruPage = {
  hits: [
    {
      id: entryId,
      contentId: 'ru-body-glaze',
      revision: 1,
      title: '汝窯的胎、釉與支釘痕',
      language: 'zh-Hant',
      fallback: false,
      kind: 'concept',
      topics: [],
      providers: ['Cleveland Museum of Art'],
      status: 'saved',
      saved: true,
      reviewState: 'reviewed',
      matchReason: 'full_text',
      matchedTokens: ['汝窯'],
      excerpt: {
        claimKey: 'features-1',
        text: 'Ru ware has a grey body and fine spur marks on the base.',
        language: 'en',
        citations: [
          {
            sourceId: 'cma-1',
            locator: 'description',
            excerptHash: 'a'.repeat(sha256Length),
          },
        ],
      },
    },
  ],
  total: 1,
  facets: [],
  nextCursor: null,
  corpusGeneration: 'g1',
  diagnostics: { mode: 'postgres', tokenizerVersion: 't1' },
} as unknown as KnowledgeSearchPage;

/**
 * a screen with the shared pill, under the provider and the root sheet, as the app mounts them
 * @param askContext what the screen attaches
 * @returns the screen and the sheet
 */
function screenWithAssistant(askContext?: AskContext): ReactElement {
  return (
    <AskAssistantProvider>
      <Screen title="Screen" askContext={askContext}>
        <Text>Screen body</Text>
      </Screen>
      <AskSheetContainer />
    </AskAssistantProvider>
  );
}

describe('rc:AskSheet with a record', () => {
  it('should attach the record and send a record question to its conversation as an unsent draft', async () => {
    const view = await renderMobile(
      screenWithAssistant({
        kind: 'record',
        recordId: 'record-1',
        name: 'Celadon dish',
        code: 'AC-0001',
      }),
      {},
    );

    await fireEvent.press(screen.getByTestId('ask-assistant'));

    expect(screen.getByTestId('ask-context')).toHaveTextContent(
      /About this item.*Celadon dish.*Attached: item AC-0001/,
    );
    expect(
      screen.getAllByTestId(/^ask-question-/).map((row) => row.props.testID),
    ).toEqual([
      'ask-question-similar',
      'ask-question-missing-photos',
      'ask-question-write',
    ]);
    await fireEvent.press(screen.getByTestId('ask-question-similar'));

    expect(view.router.push).toHaveBeenCalledWith(
      `/collection/record-1/messages?draft=${encodeURIComponent(
        'How does this item compare with museum records?',
      )}`,
    );
    expect(view.commands).not.toHaveBeenCalled();
    expect(view.patches).not.toHaveBeenCalled();
    expect(screen.queryByTestId('ask-context')).toBeNull();
  });

  it('should answer a request to write by saying the assistant never writes', async () => {
    const view = await renderMobile(
      screenWithAssistant({ kind: 'record', recordId: 'record-1' }),
      {},
    );
    await fireEvent.press(screen.getByTestId('ask-assistant'));

    await fireEvent.press(screen.getByTestId('ask-question-write'));

    expect(screen.getByTestId('ask-answer')).toHaveTextContent(
      /I don't write to your records/,
    );
    expect(screen.getAllByRole('button', { selected: true })).toEqual([
      screen.getByTestId('ask-question-write'),
    ]);
    expect(view.router.push).not.toHaveBeenCalled();
    expect(view.commands).not.toHaveBeenCalled();
  });
});

describe('rc:AskSheet without a record', () => {
  it('should answer from saved knowledge, citing the entry it quotes', async () => {
    const view = await renderMobile(screenWithAssistant(), {
      get: async () => ruPage,
    });
    await fireEvent.press(screen.getByTestId('ask-assistant'));
    expect(screen.getByTestId('ask-context')).toHaveTextContent(
      /Nothing attached/,
    );

    await fireEvent.press(screen.getByTestId('ask-question-ru'));

    await waitFor(() =>
      expect(screen.getByTestId(`ask-claim-${entryId}`)).toHaveTextContent(
        'Ru ware has a grey body and fine spur marks on the base.1',
      ),
    );
    expect(screen.getByText('Based on: Cleveland Museum of Art')).toBeVisible();
    expect(view.reads.mock.calls[0]?.[0]).toMatch(
      /^\/v1\/knowledge\/search\?.*q=Ru\+ware/,
    );
    await fireEvent.press(screen.getByTestId(`ask-cite-${entryId}`));
    expect(view.router.push).toHaveBeenCalledWith(`/knowledge/${entryId}`);
  });
});

describe('rc:AskSheet gaps and sign-in', () => {
  it('should say when saved knowledge has nothing, rather than fill the gap', async () => {
    await renderMobile(screenWithAssistant(), {
      get: async () => ({ ...ruPage, hits: [], total: 0 }),
    });
    await fireEvent.press(screen.getByTestId('ask-assistant'));

    await fireEvent.press(screen.getByTestId('ask-question-huanghuali'));

    await waitFor(() =>
      expect(screen.getByTestId('ask-answer')).toHaveTextContent(
        /Nothing in the saved sources answers this/,
      ),
    );
  });

  it('should offer only how-to answers before sign-in, in Traditional Chinese', async () => {
    await renderMobile(screenWithAssistant(), {}, savedLanguage('zh-Hant'));
    jest.mocked(useAuth).mockReturnValue({
      ...jest.mocked(useAuth)(),
      authenticated: false,
      userId: null,
    });

    await fireEvent.press(screen.getByRole('button', { name: '問助理' }));

    expect(
      screen.getAllByTestId(/^ask-question-/).map((row) => row.props.testID),
    ).toEqual(['ask-question-code', 'ask-question-approved']);
    await fireEvent.press(screen.getByTestId('ask-question-approved'));
    expect(screen.getByTestId('ask-answer')).toHaveTextContent(
      /操作說明 · 不涉及館藏知識/,
    );
  });

  it('should close from its close control and reopen at the questions', async () => {
    await renderMobile(screenWithAssistant(), {});
    await fireEvent.press(screen.getByTestId('ask-assistant'));
    await fireEvent.press(screen.getByTestId('ask-question-writes'));
    expect(screen.getByTestId('ask-answer')).toBeVisible();

    await fireEvent.press(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByTestId('ask-context')).toBeNull();
    await fireEvent.press(screen.getByTestId('ask-assistant'));

    expect(screen.getByTestId('ask-context')).toBeVisible();
    expect(screen.queryByTestId('ask-answer')).toBeNull();
  });
});

it('should keep the collector id out of the search path', async () => {
  const view = await renderMobile(screenWithAssistant(), {
    get: async () => ruPage,
  });
  await fireEvent.press(screen.getByTestId('ask-assistant'));
  await fireEvent.press(screen.getByTestId('ask-question-ru'));

  await waitFor(() => expect(view.reads).toHaveBeenCalled());
  expect(view.reads.mock.calls[0]?.[0]).not.toContain(collectorId);
});

it('should close the overlay that opened it, such as the camera, before following a question away', async () => {
  const closeCamera = jest.fn();
  const CameraPill = (): ReactElement => {
    const ask = useAskAssistant();

    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="camera pill"
        onPress={() =>
          ask?.open({ kind: 'record', recordId: 'record-1' }, closeCamera)
        }
      />
    );
  };
  const view = await renderMobile(
    <AskAssistantProvider>
      <CameraPill />
      <AskSheetContainer />
    </AskAssistantProvider>,
    {},
  );
  await fireEvent.press(screen.getByRole('button', { name: 'camera pill' }));

  await fireEvent.press(screen.getByTestId('ask-question-missing-photos'));

  expect(closeCamera).toHaveBeenCalledTimes(1);
  expect(view.router.push).toHaveBeenCalledWith(
    expect.stringMatching(/^\/collection\/record-1\/messages\?draft=/),
  );
  expect(closeCamera.mock.invocationCallOrder[0]).toBeLessThan(
    jest.mocked(view.router.push).mock.invocationCallOrder[0],
  );
});
