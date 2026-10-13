import { collectionRecord } from '../../mobile.spec.fixtures';

import { media } from '../media/media.spec.fixtures';

export const observationId = '00000000-0000-4000-8000-000000000054';
export const sourceId = '00000000-0000-4000-8000-000000000055';
export const sourceVersionId = '00000000-0000-4000-8000-000000000056';
export const pageId = '00000000-0000-4000-8000-000000000057';

export const savedReferences = [
  {
    id: '00000000-0000-4000-8000-000000000058',
    noteZhHant: '',
    reference: {
      kind: 'collection',
      recordId: collectionRecord.id,
      originalAssetId: media.asset.id,
      evidenceAnchorId: null,
    },
  },
  {
    id: '00000000-0000-4000-8000-000000000059',
    noteZhHant: 'Catalog page',
    reference: {
      kind: 'source',
      referenceImageId: null,
      locator: {
        kind: 'page',
        sourceId,
        sourceVersionId,
        pageId,
        pageIndex: 0,
        printedPageLabel: null,
        canonicalViewId: media.asset.views[0].id,
        regionId: null,
        region: null,
        textRange: null,
      },
    },
  },
  {
    id: '00000000-0000-4000-8000-000000000060',
    noteZhHant: 'Museum site',
    reference: {
      kind: 'source',
      referenceImageId: null,
      locator: {
        kind: 'web',
        sourceId,
        sourceVersionId,
        url: 'https://museum.example/bowl',
        retrievedAt: collectionRecord.createdAt,
        snapshotAssetId: null,
        blockId: null,
        excerptAsRetrieved: null,
      },
    },
  },
];
