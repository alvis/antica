import { useLocalSearchParams } from 'expo-router';

import { MediaContainer } from '../../../features/media/containers/MediaContainer';

import type { MediaContainerProps } from '../../../features/media/containers/MediaContainer';

export default function MediaRoute() {
  const { assetId, anchorId, checkId } =
    useLocalSearchParams<MediaContainerProps>();

  return (
    <MediaContainer assetId={assetId} anchorId={anchorId} checkId={checkId} />
  );
}
