import { expect, it, jest } from '@jest/globals';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import { recordMessageBodyMaxLength } from '@antica/contracts';

import {
  collectionRecord,
  renderMobile,
} from '../../../../mobile.spec.fixtures';
import {
  firstProposalId,
  run,
  runId,
} from '../../../../saved-analysis.spec.fixtures';

import { finishedJob } from '../../../analysis/containers/analysis.spec.fixtures';

import { RecordMessagesContainer } from './RecordMessagesContainer';

jest.mock('../../../../providers/AuthProvider', () => ({ useAuth: jest.fn() }));
jest.mock('expo-router', () => ({ useRouter: jest.fn() }));
jest.mock('expo-crypto', () => ({
  randomUUID:
    jest.requireActual<typeof import('node:crypto')>('node:crypto').randomUUID,
}));
jest.mock('expo-audio', () => ({
  useAudioRecorder: () => ({ uri: null }),
  requestRecordingPermissionsAsync: jest.fn(),
  setAudioModeAsync: jest.fn(),
  RecordingPresets: { HIGH_QUALITY: {} },
}));

it('should open an attached suggestion without the previous analysis block or its time chip', async () => {
  const record = { ...collectionRecord, latestRunId: runId };
  const discussedRun = {
    ...run,
    result: {
      ...run.result,
      output: run.result.output && {
        ...run.result.output,
        proposedChanges: run.result.output.proposedChanges.map((change) => ({
          ...change,
          confidence: 'medium',
        })),
      },
    },
  };
  const view = await renderMobile(
    <RecordMessagesContainer
      recordId={record.id}
      runId={runId}
      proposalId={firstProposalId}
    />,
    {
      get: async (path) =>
        path.startsWith('/v1/jobs/')
          ? finishedJob
          : path.startsWith('/v1/analyses/')
            ? discussedRun
            : path === `/v1/records/${record.id}`
              ? record
              : { items: [], nextCursor: null },
    },
  );

  expect(
    await screen.findByTestId('record-message-discuss-card'),
  ).toBeVisible();
  expect(screen.getByText('Medium confidence')).toBeVisible();
  expect(screen.queryByTestId('record-analysis-thread-finished')).toBeNull();
  expect(screen.queryByText(/Analysis done/)).toBeNull();
  expect(screen.queryByText(/The assistant never writes;/)).toBeNull();
  expect(view.commands).not.toHaveBeenCalled();
});

it('should preserve an oversized Discuss draft and allow a shorter retry without staying busy', async () => {
  const record = { ...collectionRecord, latestRunId: runId };
  const view = await renderMobile(
    <RecordMessagesContainer
      recordId={record.id}
      runId={runId}
      proposalId={firstProposalId}
    />,
    {
      get: async (path) =>
        path.startsWith('/v1/jobs/')
          ? finishedJob
          : path.startsWith('/v1/analyses/')
            ? run
            : path === `/v1/records/${record.id}`
              ? record
              : { items: [], nextCursor: null },
      post: async () => ({}),
    },
  );
  await screen.findByTestId('record-message-discuss-card');
  const words = 'x'.repeat(recordMessageBodyMaxLength);
  await fireEvent.changeText(screen.getByTestId('record-message-input'), words);
  await fireEvent.press(screen.getByTestId('record-message-send'));

  expect(await screen.findByTestId('record-message-error')).toHaveTextContent(
    'This could not be accepted. Check it and try again.',
  );
  expect(screen.getByTestId('record-message-input')).toHaveDisplayValue(words);
  expect(screen.getByTestId('record-message-send')).toBeEnabled();
  expect(view.commands).not.toHaveBeenCalled();

  await fireEvent.changeText(
    screen.getByTestId('record-message-input'),
    'Why?',
  );
  await fireEvent.press(screen.getByTestId('record-message-send'));
  await waitFor(() => expect(view.commands).toHaveBeenCalledTimes(1));
  expect(view.commands.mock.calls[0]?.[2]?.body).toMatchObject({
    body: expect.stringMatching(/^〔.+〕\nWhy\?$/u),
  });
  await waitFor(() =>
    expect(screen.getByTestId('record-message-input')).toHaveDisplayValue(''),
  );
});
