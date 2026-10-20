import {
  knowledgeCitationV2Schema,
  knowledgeClaimV2Schema,
  knowledgeImageV2Schema,
  knowledgeSearchHitSchema,
  knowledgeTopicSummarySchema,
} from '@antica/contracts';

export const topicId = '00000000-0000-4000-8000-000000000061';
export const claimId = 'surface';
export const citationId = '00000000-0000-4000-8000-000000000064';
export const imageId = '00000000-0000-4000-8000-000000000065';
const sourceId = '00000000-0000-4000-8000-000000000066';
const locatorId = '00000000-0000-4000-8000-000000000067';
const sha256Length = 64;
const sourceTextHash = 'a'.repeat(sha256Length);

export const topic = knowledgeTopicSummarySchema.parse({
  id: topicId,
  contentId: 'ceramics',
  facet: 'category',
  parentId: null,
  label: 'Ceramics',
  language: 'en',
  fallback: false,
  labels: [{ language: 'en', text: 'Ceramics', kind: 'reviewed' }],
  childCount: 2,
  savedCount: 3,
  sortOrder: 1,
});

export const citation = knowledgeCitationV2Schema.parse({
  id: citationId,
  relation: 'supports',
  availability: 'stored',
  verification: 'located',
  quote: 'A dark surface is visible in the catalogued object.',
  locator: {
    kind: 'structured',
    id: locatorId,
    sourceId,
    sourceVersionId: sourceId,
    provider: 'Cleveland Museum of Art',
    objectId: '1916.3',
    fieldPath: '/description',
    valueHash: sourceTextHash,
    url: 'https://museum.example/object/1916.3',
    retrievedAt: '2026-10-13T00:00:00.000Z',
    excerpt: 'The surface is dark.',
  },
  source: {
    id: sourceId,
    versionId: sourceId,
    title: 'Museum object record',
    canonicalUrl: 'https://museum.example/object/1916.3',
    languages: ['en'],
    contributors: ['Museum curator'],
  },
});

export const claim = knowledgeClaimV2Schema.parse({
  claimKey: claimId,
  section: 'summary',
  ordinal: 0,
  originalText: '黃花梨表面呈深色',
  originalLanguage: 'zh-Hant',
  statementType: 'observation',
  scope: { period: ['Qing'] },
  qualifiers: { condition: 'observed under daylight' },
  uncertainty: 'A later finish may affect appearance.',
  supportState: 'cited',
  citationIds: [citationId],
  review: {
    state: 'reviewed',
    actor: 'collector',
    at: '2026-10-13T00:00:00.000Z',
  },
  variants: [
    {
      language: 'en',
      kind: 'translation',
      text: 'The huanghuali surface is dark.',
      method: 'human',
      sourceTextHash,
      review: {
        state: 'reviewed',
        actor: 'collector',
        at: '2026-10-13T00:00:00.000Z',
      },
    },
  ],
});

export const hit = knowledgeSearchHitSchema.parse({
  id: '00000000-0000-4000-8000-000000000068',
  contentId: 'museum-object',
  revision: 3,
  title: '黃花梨 chair',
  language: 'zh-Hant',
  fallback: true,
  kind: 'object_example',
  topics: [topic],
  providers: ['Cleveland Museum of Art'],
  status: 'saved',
  saved: true,
  reviewState: 'reviewed',
  matchReason: 'browse',
  excerpt: {
    claimKey: claimId,
    text: 'The surface is dark.',
    language: 'en',
    citations: [citation],
  },
});

export const image = knowledgeImageV2Schema.parse({
  id: imageId,
  sourceVersionId: sourceId,
  imageUrl: 'https://museum.example/image/1916.3.jpg',
  sourcePageUrl: 'https://museum.example/object/1916.3',
  provider: 'Cleveland Museum of Art',
  width: 800,
  height: 600,
  status: 'available',
});
