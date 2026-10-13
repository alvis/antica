import { z } from 'zod';

import { publicErrorSchema } from './error.js';
import { entityIdSchema, instantSchema } from './shared.js';

export const jobKindSchema = z.enum([
  'analysis',
  'media',
  'sourceIngestion',
  'research',
  'transcription',
  'recordEditing',
]);
export type JobKind = z.infer<typeof jobKindSchema>;
export const jobStateSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('queued') }),
  z.strictObject({ kind: z.literal('running'), stage: z.string() }),
  z.strictObject({
    kind: z.literal('waiting'),
    stage: z.string(),
    resumeAfter: instantSchema.optional(),
  }),
  z.strictObject({ kind: z.literal('succeeded'), completedAt: instantSchema }),
  z.strictObject({
    kind: z.literal('partial'),
    completedAt: instantSchema,
    incompleteStages: z.array(z.string()),
  }),
  z.strictObject({ kind: z.literal('failed'), error: publicErrorSchema }),
]);
export type JobState = z.infer<typeof jobStateSchema>;
export const jobEnvelopeSchema = <T extends z.ZodType>(
  result: T,
): z.ZodObject<{
  id: typeof entityIdSchema;
  kind: typeof jobKindSchema;
  resourceId: typeof entityIdSchema;
  state: typeof jobStateSchema;
  createdAt: typeof instantSchema;
  updatedAt: typeof instantSchema;
  result: z.ZodNullable<T>;
}> =>
  z.strictObject({
    id: entityIdSchema,
    kind: jobKindSchema,
    resourceId: entityIdSchema,
    state: jobStateSchema,
    createdAt: instantSchema,
    updatedAt: instantSchema,
    result: result.nullable(),
  });
export type JobEnvelope<T = unknown> = {
  readonly id: string;
  readonly kind: JobKind;
  readonly resourceId: string;
  readonly state: JobState;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly result: T | null;
};
/** Polls lifecycle state while a resource-specific GET supplies the authoritative result. */
export const jobStatusEnvelopeSchema = jobEnvelopeSchema(z.unknown());
export const jobEventSchema = z.strictObject({
  eventId: entityIdSchema,
  schemaVersion: z.string(),
  jobId: entityIdSchema,
  resourceId: entityIdSchema,
  ownerId: z.string().min(1),
  idempotencyKey: entityIdSchema,
});
export type JobEvent = z.infer<typeof jobEventSchema>;
