import { z } from 'zod';

import { knowledgeLanguageV2Schema } from './knowledge-v2.js';
import { entityIdSchema, revisionSchema } from './shared.js';

const text = z.string().min(1).max(12_288);
const key = z.string().min(1).max(200);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const citationIds = z
  .array(entityIdSchema)
  .min(1)
  .max(3)
  .refine((ids) => new Set(ids).size === ids.length);

/** Explicit answer used when the frozen sources cannot support a reply. */
export const knowledgeNoSupportedAnswer = '尚無已儲存來源可支持此回答。';
/** Suggestions identify saved evidence; clients cannot supply factual text. */
export const knowledgeAttachmentSchema = z.strictObject({
  entryId: entityIdSchema,
  revision: revisionSchema,
  claimKey: key,
  citationIds,
});
export type KnowledgeAttachment = z.infer<typeof knowledgeAttachmentSchema>;
/** Model-authored prose refers only to server-frozen evidence identifiers. */
export const answerSegmentSchema = z.strictObject({
  text: z.string().trim().min(1).max(4000),
  evidenceRefs: z.array(knowledgeAttachmentSchema).max(6),
});
export type AnswerSegment = z.infer<typeof answerSegmentSchema>;
const citationSchema = z.strictObject({
  citationId: entityIdSchema,
  sourceId: entityIdSchema,
  sourceVersionId: entityIdSchema,
  locatorId: entityIdSchema,
  relation: z.literal('supports'),
  sourceTitle: text,
  provider: key.optional(),
  objectId: text.optional(),
  fieldPath: text.optional(),
  pageLabel: text.optional(),
  section: text.optional(),
  excerpt: text,
  sourcePageUrl: z
    .string()
    .max(2048)
    .url()
    .refine((url) => /^https?:\/\//u.test(url))
    .optional(),
});
const claimSchema = z.strictObject({
  claimId: entityIdSchema,
  claimKey: key,
  statement: text,
  originalText: text,
  language: knowledgeLanguageV2Schema,
  scope: z.record(key, z.array(text).max(100)),
  qualifiers: z.record(key, text),
  uncertainty: text.optional(),
  sourceVersionIds: z.array(entityIdSchema).min(1).max(3),
  citations: z.array(citationSchema).min(1).max(3),
});
const evidenceEntrySchema = z.strictObject({
  entryId: entityIdSchema,
  revision: revisionSchema,
  contentHash: hash,
  title: text,
  claims: z.array(claimSchema).min(1).max(6),
});
/** Immutable evidence displayed with historical assistant messages. */
export const knowledgeEvidenceSnapshotV1Schema = z
  .strictObject({
    schemaVersion: z.literal(1),
    snapshotId: entityIdSchema,
    snapshotHash: hash,
    recordId: entityIdSchema,
    recordRevision: revisionSchema,
    corpusGeneration: z.string().min(1).max(200),
    entries: z.array(evidenceEntrySchema).max(3),
  })
  .refine(
    (snapshot) =>
      snapshot.entries.reduce((sum, entry) => sum + entry.claims.length, 0) <=
      6,
    { message: 'At most six claims may be grounded' },
  )
  .refine(
    (snapshot) => knowledgeEvidenceTextBytes(snapshot.entries) <= 12_288,
    { message: 'Grounded text exceeds 12 KiB' },
  );
export type KnowledgeEvidenceSnapshotV1 = z.infer<
  typeof knowledgeEvidenceSnapshotV1Schema
>;

/**
 * Counts every displayed factual or locator string, including scope keys.
 * @param entries complete frozen evidence entries
 * @returns UTF-8 byte count of grounded text, excluding reference identifiers
 */
export function knowledgeEvidenceTextBytes(
  entries: Array<z.infer<typeof evidenceEntrySchema>>,
): number {
  const strings = entries.flatMap((entry) => [
    entry.title,
    ...entry.claims.flatMap((claim) => [
      claim.statement,
      claim.originalText,
      claim.language,
      claim.uncertainty ?? '',
      ...Object.entries(claim.scope).flatMap(([name, values]) => [
        name,
        ...values,
      ]),
      ...Object.entries(claim.qualifiers).flat(),
      ...claim.citations.flatMap((citation) => [
        citation.sourceTitle,
        citation.provider ?? '',
        citation.objectId ?? '',
        citation.fieldPath ?? '',
        citation.pageLabel ?? '',
        citation.section ?? '',
        citation.excerpt,
        citation.sourcePageUrl ?? '',
      ]),
    ]),
  ]);

  return new TextEncoder().encode(strings.join('')).byteLength;
}
