import { z } from 'zod';

import {
  knowledgeLocaleSchema,
  knowledgeSearchHitSchema,
} from './knowledge-search.js';
import { entityIdSchema, revisionSchema } from './shared.js';

const maximumTextLength = 24_000;
const maximumCards = 3;
const maximumLanguageLength = 35;
const maximumTopics = 100;
const maximumIdentifierLength = 200;
const maximumProviders = 1_000;

const textSchema = z.string().min(1).max(maximumTextLength);
const topicSchema = z.strictObject({
  topicId: entityIdSchema,
  label: textSchema,
});

/** bounds one record's saved contextual discovery request */
export const relatedKnowledgeQuerySchema = z.strictObject({
  locale: knowledgeLocaleSchema.default('zh-Hant'),
  limit: z.coerce.number().int().min(1).max(maximumCards).default(maximumCards),
  recordRevision: z.coerce.number().int().positive().optional(),
});
export type RelatedKnowledgeQuery = z.infer<typeof relatedKnowledgeQuerySchema>;

/** identifies the explicit record field and the saved term that matched */
export const relatedKnowledgeMatchSchema = z.strictObject({
  field: z.enum(['category', 'material', 'period', 'name']),
  value: textSchema,
  topicId: entityIdSchema.nullable(),
  label: textSchema,
  matchedTokens: z
    .array(z.string().min(1).max(maximumTextLength))
    .max(maximumTextLength),
});

/** pins one saved entry and at most one reviewed, located supporting excerpt */
export const relatedKnowledgeCardSchema = z.strictObject({
  entryId: entityIdSchema,
  revision: revisionSchema,
  title: textSchema,
  language: z.string().min(1).max(maximumLanguageLength),
  fallback: z.boolean(),
  kind: z.enum(['concept', 'method', 'object_example']),
  category: z.array(topicSchema).max(maximumTopics),
  matches: z.array(relatedKnowledgeMatchSchema).min(1).max(maximumTopics),
  excerpt: knowledgeSearchHitSchema.shape.excerpt
    .unwrap()
    .extend({
      claimKey: z.string().min(1).max(maximumIdentifierLength),
      text: textSchema,
      language: z.string().min(1).max(maximumLanguageLength),
      citations: knowledgeSearchHitSchema.shape.excerpt
        .unwrap()
        .shape.citations.max(maximumTopics),
    })
    .nullable(),
  providers: z
    .array(z.string().min(1).max(maximumIdentifierLength))
    .max(maximumProviders),
});

/** binds contextual cards to the exact record revision and explicit context */
export const relatedKnowledgePageSchema = z.strictObject({
  cards: z.array(relatedKnowledgeCardSchema).max(maximumCards),
  recordRevision: revisionSchema,
  contextHash: z.string().regex(/^[a-f0-9]{64}$/),
  reason: z.literal('no_match').optional(),
});
export type RelatedKnowledgePage = z.infer<typeof relatedKnowledgePageSchema>;

/** optional single-snapshot read supported by persistent knowledge discovery */
export interface RelatedKnowledgeDiscovery {
  related(
    ownerId: string,
    recordId: string,
    query: RelatedKnowledgeQuery,
  ): Promise<RelatedKnowledgePage | null>;
}
