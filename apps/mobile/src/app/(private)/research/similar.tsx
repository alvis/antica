import { useLocalSearchParams } from 'expo-router';

import { SimilarSearchContainer } from '../../../features/search/containers/SimilarSearchContainer';

import type { SimilarSearchContainerProps } from '../../../features/search/containers/SimilarSearchContainer';

export default function SimilarRoute() {
  const { anchorId, recordId, assetId, viewId } =
    useLocalSearchParams<SimilarSearchContainerProps>();

  return (
    <SimilarSearchContainer
      anchorId={anchorId}
      recordId={recordId}
      assetId={assetId}
      viewId={viewId}
    />
  );
}
