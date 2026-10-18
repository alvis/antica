import { useLocalSearchParams } from 'expo-router';

import { KnowledgeDetailContainer } from '../../../features/knowledge/containers/KnowledgeDetailContainer';

import type { KnowledgeDetailContainerProps } from '../../../features/knowledge/containers/KnowledgeDetailContainer';

export default function KnowledgeDetailRoute() {
  const { entryId } = useLocalSearchParams<KnowledgeDetailContainerProps>();

  return <KnowledgeDetailContainer entryId={entryId} />;
}
