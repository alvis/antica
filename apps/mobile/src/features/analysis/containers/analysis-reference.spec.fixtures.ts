import { collectionRecord } from '../../../mobile.spec.fixtures';
import { evidenceId } from '../../../saved-analysis.spec.fixtures';

import { media, prepared } from '../../media/containers/media.spec.fixtures';

export const supported = {
  ...media,
  anchors: [
    {
      id: evidenceId,
      kind: 'video_frame',
      frame: prepared.frame,
      recordId: collectionRecord.id,
      componentIds: [],
      originalAssetId: media.asset.id,
      canonicalViewId: prepared.view.id,
      scope: { kind: 'whole' },
      createdAt: collectionRecord.createdAt,
    },
  ],
};
