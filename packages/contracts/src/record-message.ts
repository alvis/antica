import { z } from 'zod';

import { proposedChangeSchema } from './analysis.js';
import {
  answerSegmentSchema,
  knowledgeAttachmentSchema,
  knowledgeEvidenceSnapshotV1Schema,
} from './knowledge-evidence.js';
import {
  MAX_PAGE_SIZE,
  cursorPageSchema,
  entityIdSchema,
  instantSchema,
  revisionSchema,
} from './shared.js';
import { editDraftAcceptedSchema } from './workflow.js';

export const recordMessageAuthorSchema = z.enum(['collector', 'assistant']);
export type RecordMessageAuthor = z.infer<typeof recordMessageAuthorSchema>;

/** longest message the collector can type, in UTF-16 code units */
export const recordMessageBodyMaxLength = 2000;

/** longest assistant reply the app stores and shows; longer model replies are truncated, not rejected */
export const recordMessageReplyMaxLength = 4000;

/** one entry of the per-record conversation between the collector and the assistant */
export const recordMessageSchema = z.strictObject({
  id: entityIdSchema,
  recordId: entityIdSchema,
  author: recordMessageAuthorSchema,
  knowledgeEvidence: z
    .union([knowledgeEvidenceSnapshotV1Schema, z.tuple([])])
    .optional(),
  answerSegments: z.array(answerSegmentSchema).max(32).optional(),
  body: z.string().trim().min(1),
  editDraftId: entityIdSchema,
  createdAt: instantSchema,
});
export type RecordMessage = z.infer<typeof recordMessageSchema>;

/** what the app sends; a voice-only post carries its text through confirmed transcriptions */
export const recordMessagePostSchema = z
  .strictObject({
    requestKey: entityIdSchema,
    body: z.string().trim().max(recordMessageBodyMaxLength),
    transcriptionIds: z.array(entityIdSchema),
    expectedRecordRevision: revisionSchema,
    knowledgeAttachments: z.array(knowledgeAttachmentSchema).max(6).optional(),
  })
  .refine(
    ({ body, transcriptionIds }) => body !== '' || transcriptionIds.length > 0,
    { message: 'A message needs a body or a transcription', path: ['body'] },
  );
export type RecordMessagePost = z.infer<typeof recordMessagePostSchema>;

/** the stored collector message and the edit draft its post started */
export const recordMessagePostedSchema = editDraftAcceptedSchema
  .safeExtend({
    knowledgeSnapshot: z
      .strictObject({
        snapshotId: entityIdSchema,
        snapshotHash: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .optional(),
    message: recordMessageSchema.safeExtend({
      author: z.literal('collector'),
    }),
  })
  .refine(({ message, editDraftId }) => message.editDraftId === editDraftId, {
    message: 'The message must reference the edit draft it started',
    path: ['message', 'editDraftId'],
  });
export type RecordMessagePosted = z.infer<typeof recordMessagePostedSchema>;

/** where an edit draft stands; `failed` means its job ended without producing a result */
export const recordMessageDraftStatusSchema = z.enum([
  'pending',
  'ready',
  'partially_applied',
  'applied',
  'failed',
]);
export type RecordMessageDraftStatus = z.infer<
  typeof recordMessageDraftStatusSchema
>;

/** the edit card behind a message: the draft's progress and its per-field proposals */
export const recordMessageDraftSchema = z.strictObject({
  status: recordMessageDraftStatusSchema,
  /** pass as `expectedDraftRevision` when applying proposals */
  revision: revisionSchema,
  /** empty until the draft is ready */
  proposedChanges: z.array(proposedChangeSchema),
  /** proposals already written to the record */
  appliedProposalIds: z.array(entityIdSchema),
  /** proposals the collector rejected, which can no longer be applied */
  skippedProposalIds: z.array(entityIdSchema),
});
export type RecordMessageDraft = z.infer<typeof recordMessageDraftSchema>;

/** a message together with the current state of the edit draft it belongs to */
export const recordMessageEntrySchema = recordMessageSchema.safeExtend({
  draft: recordMessageDraftSchema,
});
export type RecordMessageEntry = z.infer<typeof recordMessageEntrySchema>;

/** selects one page of a record's conversation; the first page holds the newest messages */
export const recordMessageListQuerySchema = z.strictObject({
  cursor: z.string().optional(),
  limit: z.int().min(1).max(MAX_PAGE_SIZE).optional(),
});
export type RecordMessageListQuery = z.infer<
  typeof recordMessageListQuerySchema
>;

/** one page in chronological order, oldest first; `nextCursor` continues with older messages */
export const recordMessagePageSchema = cursorPageSchema(
  recordMessageEntrySchema,
);
export type RecordMessagePage = z.infer<typeof recordMessagePageSchema>;
