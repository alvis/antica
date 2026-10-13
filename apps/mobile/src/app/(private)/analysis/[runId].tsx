import { AnalysisContainer } from '../../../features/analysis/AnalysisContainer';
import { useLocalSearchParams } from 'expo-router';

export default function AnalysisRoute() {
  const { runId } = useLocalSearchParams<{ runId: string }>();

  return <AnalysisContainer runId={runId} />;
}
