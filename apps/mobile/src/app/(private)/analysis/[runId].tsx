import { useLocalSearchParams } from 'expo-router';

import { AnalysisContainer } from '../../../features/analysis/containers/AnalysisContainer';

import type { AnalysisContainerProps } from '../../../features/analysis/containers/AnalysisContainer';

export default function AnalysisRoute() {
  const { runId } = useLocalSearchParams<AnalysisContainerProps>();

  return <AnalysisContainer runId={runId} />;
}
