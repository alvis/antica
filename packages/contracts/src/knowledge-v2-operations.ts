import { z } from 'zod';

import {
  knowledgeContentEnvelopeV2InputSchema,
  knowledgeContentEnvelopeV2Schema,
  knowledgeLanguageV2Schema,
  knowledgeReviewDecisionSchema,
  knowledgeTranslationDecisionSchema,
} from './knowledge-v2.js';
import { entityIdSchema, instantSchema, revisionSchema } from './shared.js';

const maximumKeyLength = 200;
const maximumLargeCollectionSize = 1_000;
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

const knowledgeWriteV2Shape = {
  requestKey: entityIdSchema,
  status: z.enum(['draft', 'saved']),
  content: knowledgeContentEnvelopeV2InputSchema,
  reviewDecisions: z
    .array(knowledgeReviewDecisionSchema)
    .max(maximumLargeCollectionSize),
  translationDecisions: z
    .array(knowledgeTranslationDecisionSchema)
    .max(maximumLargeCollectionSize),
};
export const knowledgeWriteV2Schema = z.strictObject({
  ...knowledgeWriteV2Shape,
  expectedRevision: z.null(),
});
export type KnowledgeWriteV2 = z.infer<typeof knowledgeWriteV2Schema>;
export const knowledgeUpdateV2Schema = z.strictObject({
  ...knowledgeWriteV2Shape,
  expectedRevision: revisionSchema,
});
export type KnowledgeUpdateV2 = z.infer<typeof knowledgeUpdateV2Schema>;
export const knowledgeReadV2Schema = z
  .strictObject({
    view: z.enum(['working', 'saved', 'revision']).optional(),
    revision: z.coerce.number().pipe(revisionSchema).optional(),
    locale: knowledgeLanguageV2Schema.optional(),
  })
  .refine(
    (read) =>
      (read.view === 'revision') === (read.revision !== undefined) ||
      read.view === undefined,
  );
export type KnowledgeReadV2 = z.infer<typeof knowledgeReadV2Schema>;
export const knowledgeEntryDetailV2Schema = z.strictObject({
  id: entityIdSchema,
  displayCode: z.string().min(1).max(maximumKeyLength),
  revision: revisionSchema,
  status: z.enum(['draft', 'saved']),
  savedBy: z.literal('collector').nullable(),
  contentHash: sha256Schema,
  createdAt: instantSchema,
  updatedAt: instantSchema,
  content: knowledgeContentEnvelopeV2Schema,
});
export type KnowledgeEntryDetailV2 = z.infer<
  typeof knowledgeEntryDetailV2Schema
>;
