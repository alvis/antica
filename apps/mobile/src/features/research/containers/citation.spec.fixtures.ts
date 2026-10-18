import { researchDetailSchema } from '@antica/contracts';

import { collectionRecord } from '../../../mobile.spec.fixtures';

export const researchId = '00000000-0000-4000-8000-000000000030';
export const citationId = '10000000-0000-4000-8000-000000000031';
export const sourceId = '20000000-0000-4000-8000-000000000032';
export const pageId = '00000000-0000-4000-8000-000000000033';
export const citation = {
  id: citationId,
  relation: 'supports',
  availability: 'stored',
  verification: 'located',
  locator: {
    kind: 'page',
    sourceId,
    sourceVersionId: sourceId,
    pageId,
    pageIndex: 7,
    printedPageLabel: '12',
    canonicalViewId: pageId,
    regionId: null,
    region: null,
    textRange: null,
  },
};
export const detail = researchDetailSchema.parse({
  researchId,
  jobId: researchId,
  state: { kind: 'succeeded', completedAt: collectionRecord.createdAt },
  request: {
    requestKey: researchId,
    instructionZhHant: 'Compare the decoration',
    scope: 'curated_only',
    recordId: collectionRecord.id,
    entryId: null,
    sourceIds: [sourceId],
    preferNamedAuthors: true,
  },
  sourceIds: [sourceId],
  notes: [],
  warningsZhHant: [],
  draft: {
    revision: 2,
    titleZhHant: 'Decoration research',
    paragraphs: [
      {
        textZhHant: 'Original passage',
        citationIds: [citationId],
        support: 'cited',
      },
    ],
    citations: [citation],
    unresolvedQuestionsZhHant: [],
  },
});

export const webUrl = 'https://museum.example/research#source';
export const richDetail = researchDetailSchema.parse({
  ...detail,
  request: { ...detail.request, scope: 'curated_and_public_web' },
  warningsZhHant: ['Check the attribution'],
  notes: [
    {
      id: researchId,
      researchId,
      titleZhHant: 'Saved comparison',
      paragraphs: [
        {
          textZhHant: 'Collector conclusion',
          citationIds: [],
          support: 'needs_source',
        },
      ],
      citations: [],
      recordId: collectionRecord.id,
      entryId: null,
      savedBy: 'collector',
      savedAt: collectionRecord.createdAt,
    },
  ],
  draft: {
    ...detail.draft!,
    paragraphs: [
      {
        textZhHant: 'Unverified attribution',
        citationIds: [],
        support: 'needs_source',
      },
    ],
    citations: [
      {
        ...citation,
        id: citationId,
        locator: {
          kind: 'web',
          sourceId,
          sourceVersionId: sourceId,
          url: webUrl,
          retrievedAt: collectionRecord.createdAt,
          snapshotAssetId: null,
          blockId: null,
          excerptAsRetrieved: null,
        },
      },
    ],
  },
});
