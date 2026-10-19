import { z } from 'zod';

import {
  knowledgeLanguageV2Schema,
  knowledgeCitationV2Schema,
} from './knowledge-v2.js';
import { entityIdSchema } from './shared.js';

const maximumCursorLength = 4096;
const maximumQueryCodePoints = 160;
const maximumSearchSize = 50;
const maximumProviderLength = 200;
const maximumTreeDepth = 3;
const defaultSearchSize = 20;
const maximumTopicSize = 100;

export const knowledgeFacetSchema = z.enum([
  'category',
  'material',
  'object_type',
  'period',
  'region',
  'kiln_maker',
  'technique',
  'motif',
  'mark',
  'surface',
  'condition',
  'repair_restoration',
  'authentication_limit',
  'provenance',
]);
export const knowledgeLocaleSchema = z.enum(['zh-Hant', 'en']);
const cursorSchema = z.string().min(1).max(maximumCursorLength);
const queryTextSchema = z
  .string()
  .refine(
    (text) => [...text].length <= maximumQueryCodePoints,
    'Query exceeds 160 code points',
  );
export const knowledgeSearchQuerySchema = z.strictObject({
  q: queryTextSchema.optional(),
  topics: z
    .partialRecord(
      knowledgeFacetSchema,
      z.array(entityIdSchema).min(1).max(maximumSearchSize),
    )
    .optional(),
  providers: z
    .array(z.string().min(1).max(maximumProviderLength))
    .max(maximumSearchSize)
    .optional(),
  languages: z
    .array(knowledgeLanguageV2Schema)
    .max(maximumSearchSize)
    .optional(),
  entryTypes: z
    .array(z.enum(['concept', 'method', 'object_example']))
    .max(maximumTreeDepth)
    .optional(),
  view: z.enum(['saved', 'working']).default('saved'),
  locale: knowledgeLocaleSchema.default('zh-Hant'),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(maximumSearchSize)
    .default(defaultSearchSize),
  cursor: cursorSchema.optional(),
});
export type KnowledgeSearchQuery = z.infer<typeof knowledgeSearchQuerySchema>;
export const knowledgeTopicsQuerySchema = z.strictObject({
  facet: knowledgeFacetSchema.optional(),
  parentId: entityIdSchema.optional(),
  q: queryTextSchema.optional(),
  locale: knowledgeLocaleSchema.default('zh-Hant'),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(maximumTopicSize)
    .default(maximumSearchSize),
  cursor: cursorSchema.optional(),
});
export type KnowledgeTopicsQuery = z.infer<typeof knowledgeTopicsQuerySchema>;
export const knowledgeTopicTreeQuerySchema = z.strictObject({
  locale: knowledgeLocaleSchema.default('zh-Hant'),
  depth: z.coerce.number().int().min(1).max(maximumTreeDepth).default(1),
  childrenLimit: z.coerce
    .number()
    .int()
    .min(1)
    .max(maximumTopicSize)
    .default(maximumSearchSize),
  cursor: cursorSchema.optional(),
});
export type KnowledgeTopicTreeQuery = z.infer<
  typeof knowledgeTopicTreeQuerySchema
>;
export const knowledgeTopicSummarySchema = z.strictObject({
  id: entityIdSchema,
  contentId: z.string(),
  facet: knowledgeFacetSchema,
  parentId: entityIdSchema.nullable(),
  label: z.string(),
  language: z.string(),
  fallback: z.boolean(),
  labels: z.array(
    z.strictObject({
      language: z.string(),
      text: z.string(),
      kind: z.string(),
    }),
  ),
  childCount: z.number().int().nonnegative(),
  savedCount: z.number().int().nonnegative(),
  sortOrder: z.number().int(),
});
export type KnowledgeTopicSummary = z.infer<typeof knowledgeTopicSummarySchema>;
export const knowledgeTopicsPageSchema = z.strictObject({
  items: z.array(knowledgeTopicSummarySchema),
  total: z.number().int().nonnegative(),
  nextCursor: cursorSchema.nullable(),
});
export type KnowledgeTopicsPage = z.infer<typeof knowledgeTopicsPageSchema>;
export const knowledgeTopicTreeSchema = z.strictObject({
  topic: knowledgeTopicSummarySchema,
  ancestors: z.array(knowledgeTopicSummarySchema),
  descendants: z.array(
    knowledgeTopicSummarySchema.extend({
      depth: z.number().int(),
      hasMore: z.boolean(),
    }),
  ),
  related: z.array(
    z.strictObject({
      id: entityIdSchema,
      label: z.string(),
      relation: z.string(),
    }),
  ),
  nextCursor: cursorSchema.nullable(),
});
export type KnowledgeTopicTree = z.infer<typeof knowledgeTopicTreeSchema>;
export const knowledgeSearchHitSchema = z.strictObject({
  id: entityIdSchema,
  contentId: z.string().nullable(),
  revision: z.number().int().positive(),
  title: z.string(),
  language: z.string(),
  fallback: z.boolean(),
  kind: z.enum(['concept', 'method', 'object_example']),
  topics: z.array(knowledgeTopicSummarySchema),
  providers: z.array(z.string()),
  status: z.enum(['draft', 'saved']),
  saved: z.boolean(),
  reviewState: z.enum(['pending', 'reviewed', 'rejected']),
  matchReason: z.enum([
    'exact_title_alias',
    'exact_mark_phrase',
    'full_text',
    'best_match',
    'bigram',
    'trigram',
    'prefix',
    'browse',
  ]),
  matchedTokens: z.array(z.string()).default([]),
  excerpt: z
    .strictObject({
      claimKey: z.string(),
      text: z.string(),
      language: z.string(),
      citations: z.array(knowledgeCitationV2Schema).min(1),
    })
    .nullable(),
});
export type KnowledgeSearchHit = z.infer<typeof knowledgeSearchHitSchema>;
export const knowledgeSearchPageSchema = z.strictObject({
  hits: z.array(knowledgeSearchHitSchema),
  total: z.number().int().nonnegative(),
  facets: z.array(
    z.strictObject({
      facet: z.string(),
      id: z.string(),
      count: z.number().int().nonnegative(),
    }),
  ),
  nextCursor: cursorSchema.nullable(),
  corpusGeneration: z.string(),
  diagnostics: z.strictObject({
    mode: z.enum(['postgres', 'degraded']),
    tokenizerVersion: z.string(),
  }),
});
export type KnowledgeSearchPage = z.infer<typeof knowledgeSearchPageSchema>;
