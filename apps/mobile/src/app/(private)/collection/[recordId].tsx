import { useLocalSearchParams } from 'expo-router';

import { RecordContainer } from '../../../features/collection/RecordContainer';

import type { RecordContainerProps } from '../../../features/collection/RecordContainer';

export default function RecordRoute() {
  const { recordId } = useLocalSearchParams<RecordContainerProps>();

  return <RecordContainer recordId={recordId} />;
}
