import { useLocalSearchParams } from 'expo-router';

import { RecordMessagesContainer } from '../../../../features/collection/messages/containers/RecordMessagesContainer';

import type { ReactElement } from 'react';

import type { RecordMessagesContainerProps } from '../../../../features/collection/messages/containers/RecordMessagesContainer';

export default function RecordMessagesRoute(): ReactElement {
  const { recordId, messageId } =
    useLocalSearchParams<RecordMessagesContainerProps>();

  return <RecordMessagesContainer recordId={recordId} messageId={messageId} />;
}
