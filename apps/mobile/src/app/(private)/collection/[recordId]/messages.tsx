import { useLocalSearchParams } from 'expo-router';

import { RecordMessagesContainer } from '../../../../features/collection/messages/containers/RecordMessagesContainer';

import type { RecordMessagesContainerProps } from '../../../../features/collection/messages/containers/RecordMessagesContainer';

export default function RecordMessagesRoute() {
  const { recordId } = useLocalSearchParams<RecordMessagesContainerProps>();

  return <RecordMessagesContainer recordId={recordId} />;
}
