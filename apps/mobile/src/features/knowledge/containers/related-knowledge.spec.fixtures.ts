import { relatedKnowledgePageSchema } from '@antica/contracts';

import { citation, hit, topic } from '../components/knowledge.spec.fixtures';

const sha256Length = 64;
export const relatedRecordId = '00000000-0000-4000-8000-000000000001';

export const relatedCard = {
  entryId: hit.id,
  revision: hit.revision,
  title: hit.title,
  language: hit.language,
  fallback: hit.fallback,
  kind: hit.kind,
  category: [{ topicId: topic.id, label: topic.label }],
  matches: [
    {
      field: 'category' as const,
      value: 'ceramics',
      topicId: topic.id,
      label: 'Ceramics',
      matchedTokens: ['ceramics'],
    },
  ],
  excerpt: hit.excerpt ?? null,
  providers: hit.providers,
};
export const relatedPage = relatedKnowledgePageSchema.parse({
  cards: [relatedCard],
  recordRevision: 1,
  contextHash: 'a'.repeat(sha256Length),
});
export const relatedAttachment = {
  entryId: hit.id,
  revision: hit.revision,
  claimKey: 'surface',
  citationIds: [citation.id],
};
export const relatedPath = `/v1/records/${relatedRecordId}/related-knowledge`;
