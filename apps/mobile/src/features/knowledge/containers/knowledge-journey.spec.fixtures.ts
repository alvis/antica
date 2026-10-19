import {
  knowledgeContentEnvelopeV2Schema,
  knowledgeEntryDetailV2Schema,
  knowledgeSearchPageSchema,
  knowledgeTopicsPageSchema,
  knowledgeTopicTreeSchema,
} from '@antica/contracts';

import {
  citation,
  claim,
  hit,
  image,
  topic,
} from '../components/knowledge.spec.fixtures';

const sha256Length = 64;

export const knowledgeEntry = knowledgeEntryDetailV2Schema.parse({
  id: hit.id,
  displayCode: 'K-1',
  revision: 3,
  status: 'saved',
  savedBy: 'collector',
  contentHash: 'b'.repeat(sha256Length),
  createdAt: '2026-10-13T00:00:00.000Z',
  updatedAt: '2026-10-13T00:00:00.000Z',
  content: knowledgeContentEnvelopeV2Schema.parse({
    contentSchemaVersion: 2,
    entryType: 'object_example',
    origin: 'curated_seed',
    titles: [{ language: 'zh-Hant', text: '黃花梨 chair' }],
    aliases: [],
    sections: {
      summary: {
        claimKey: claim.claimKey,
        text: claim.originalText,
        citationIds: claim.citationIds,
        supportState: claim.supportState,
      },
      history: [],
      features: [],
      applicability: [],
      limits: [],
    },
    topics: [{ topicId: topic.id, applicability: 'specific' }],
    citations: [citation],
    images: [image],
    methodIds: [],
    relatedEntryIds: [],
    claims: [claim],
    editorialReview: {
      state: 'reviewed',
      actor: 'collector',
      at: '2026-10-13T00:00:00.000Z',
    },
  }),
});

export const searchPage = knowledgeSearchPageSchema.parse({
  hits: [hit],
  total: 1,
  facets: [
    { facet: 'provider', id: 'Cleveland Museum of Art', count: 1 },
    { facet: 'language', id: 'zh-Hant', count: 1 },
    { facet: 'entryType', id: 'object_example', count: 1 },
  ],
  nextCursor: null,
  corpusGeneration: 'fixture',
  diagnostics: { mode: 'postgres', tokenizerVersion: '1' },
});

export const topicsPage = knowledgeTopicsPageSchema.parse({
  items: [topic],
  total: 1,
  nextCursor: null,
});

export const topicTree = knowledgeTopicTreeSchema.parse({
  topic,
  ancestors: [],
  descendants: [
    {
      ...topic,
      id: '00000000-0000-4000-8000-000000000069',
      parentId: topic.id,
      depth: 1,
      hasMore: false,
      label: 'Glazes',
    },
  ],
  related: [],
  nextCursor: null,
});
