import { RecordContainer } from '../../../features/collection/RecordContainer';
import { useLocalSearchParams } from 'expo-router';

export default function RecordRoute() {
  const { recordId } = useLocalSearchParams<{ recordId: string }>();

  return <RecordContainer recordId={recordId} />;
}
