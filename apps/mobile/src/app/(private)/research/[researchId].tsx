import { useLocalSearchParams } from 'expo-router';

import { ResearchDetailContainer } from '../../../features/research/containers/ResearchDetailContainer';

import type { ResearchDetailContainerProps } from '../../../features/research/containers/ResearchDetailContainer';

export default function ResearchDetailRoute() {
  const { researchId } = useLocalSearchParams<ResearchDetailContainerProps>();

  return <ResearchDetailContainer researchId={researchId} />;
}
