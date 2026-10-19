import { useLocalSearchParams } from 'expo-router';

import { RecordHistoryContainer } from '../../../../features/collection/containers/RecordHistoryContainer';

import type { ReactElement } from 'react';

import type { RecordHistoryContainerProps } from '../../../../features/collection/containers/RecordHistoryContainer';

export default function RecordHistoryRoute(): ReactElement {
  const { recordId } = useLocalSearchParams<RecordHistoryContainerProps>();

  return <RecordHistoryContainer recordId={recordId} />;
}
