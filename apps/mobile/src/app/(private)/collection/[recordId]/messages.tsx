import { useLocalSearchParams } from 'expo-router';

import { RecordMessagesContainer } from '../../../../features/collection/messages/containers/RecordMessagesContainer';

import type { ReactElement } from 'react';

import type { RecordMessagesContainerProps } from '../../../../features/collection/messages/containers/RecordMessagesContainer';

export default function RecordMessagesRoute(): ReactElement {
  const { recordId, messageId, draft, runId, proposalId, startedRunId } =
    useLocalSearchParams<RecordMessagesContainerProps>();

  return (
    <RecordMessagesContainer
      recordId={recordId}
      messageId={messageId}
      draft={draft}
      runId={runId}
      proposalId={proposalId}
      startedRunId={startedRunId}
    />
  );
}
