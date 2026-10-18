import { useLocalSearchParams } from 'expo-router';

import { NewResearchContainer } from '../../../features/research/containers/NewResearchContainer';

import type { NewResearchContainerProps } from '../../../features/research/containers/NewResearchContainer';

export default function NewResearchRoute() {
  const { recordId, entryId } =
    useLocalSearchParams<NewResearchContainerProps>();

  return <NewResearchContainer recordId={recordId} entryId={entryId} />;
}
