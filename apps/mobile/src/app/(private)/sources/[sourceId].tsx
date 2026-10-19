import { useLocalSearchParams } from 'expo-router';

import { SourceDetailContainer } from '../../../features/sources/containers/SourceDetailContainer';

import type { SourceDetailContainerProps } from '../../../features/sources/containers/SourceDetailContainer';

export default function SourceDetailRoute() {
  const { sourceId, versionId, pageId } =
    useLocalSearchParams<SourceDetailContainerProps>();

  return (
    <SourceDetailContainer
      sourceId={sourceId}
      versionId={versionId}
      pageId={pageId}
    />
  );
}
