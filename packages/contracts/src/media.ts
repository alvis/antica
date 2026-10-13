import { z } from 'zod';

import { MAX_ROTATION_QUARTER_TURNS } from '@antica/domain';

import { jobEnvelopeSchema } from './job.js';
import {
  entityIdSchema,
  instantSchema,
  recordVersionsSchema,
} from './shared.js';

import type {
  EvidenceAnchor,
  EvidenceInput,
  CanonicalView,
  Region,
} from '@antica/domain';

export const pointSchema = z.strictObject({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
});
const MIN_POLYGON_POINTS = 3;
export const rotationQuarterTurnsSchema = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(MAX_ROTATION_QUARTER_TURNS),
]);
export const rectRegionSchema = z
  .strictObject({
    kind: z.literal('rect'),
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().positive().max(1),
    height: z.number().positive().max(1),
  })
  .refine(
    (region) => region.x + region.width <= 1 && region.y + region.height <= 1,
  );
export const regionSchema = z.discriminatedUnion('kind', [
  rectRegionSchema,
  z
    .strictObject({
      kind: z.literal('polygon'),
      points: z.array(pointSchema).min(MIN_POLYGON_POINTS).readonly(),
    })
    .refine((region) => {
      let area = 0;
      for (let index = 0; index < region.points.length; index += 1) {
        const current = region.points[index]!;
        const next = region.points[(index + 1) % region.points.length]!;
        area += current.x * next.y - next.x * current.y;
      }

      return Math.abs(area) > 0;
    }),
]);
export const canonicalViewSchema: z.ZodType<CanonicalView> = z.strictObject({
  id: entityIdSchema,
  originalAssetId: entityIdSchema,
  derivativeId: entityIdSchema.nullable(),
  width: z.int().positive(),
  height: z.int().positive(),
  originalCoordinateSpace: z.enum([
    'image_pixels',
    'video_frame_pixels',
    'pdf_page_points',
  ]),
  transformToOriginal: z.tuple([
    z.number(),
    z.number(),
    z.number(),
    z.number(),
    z.number(),
    z.number(),
    z.number(),
    z.number(),
    z.number(),
  ]),
});
export const frameLocatorSchema = z.strictObject({
  streamIndex: z.int().nonnegative(),
  timeBase: z.strictObject({
    numerator: z.int().positive(),
    denominator: z.int().positive(),
  }),
  pts: z.string().regex(/^-?\d+$/),
  frameDerivativeId: entityIdSchema,
  displayTimeMs: z.number().nonnegative(),
});
export const evidenceScopeSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('whole') }),
  z.strictObject({
    kind: z.literal('region'),
    region: regionSchema,
    cropDerivativeId: entityIdSchema.nullable(),
  }),
]);
const evidenceBase = {
  recordId: entityIdSchema,
  componentIds: z.array(entityIdSchema),
  originalAssetId: entityIdSchema,
  canonicalViewId: entityIdSchema,
  scope: evidenceScopeSchema,
};
export const evidenceInputSchema: z.ZodType<EvidenceInput> =
  z.discriminatedUnion('kind', [
    z.strictObject({ ...evidenceBase, kind: z.literal('image') }),
    z.strictObject({
      ...evidenceBase,
      kind: z.literal('video_frame'),
      frame: frameLocatorSchema,
    }),
  ]);
export const evidenceAnchorSchema: z.ZodType<EvidenceAnchor> =
  z.discriminatedUnion('kind', [
    z.strictObject({
      ...evidenceBase,
      kind: z.literal('image'),
      id: entityIdSchema,
      createdAt: instantSchema,
    }),
    z.strictObject({
      ...evidenceBase,
      kind: z.literal('video_frame'),
      frame: frameLocatorSchema,
      id: entityIdSchema,
      createdAt: instantSchema,
    }),
  ]);
export const mediaOwnerSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('record'), recordId: entityIdSchema }),
  z.strictObject({
    kind: z.literal('source_intake'),
    intakeKey: entityIdSchema,
  }),
  z.strictObject({
    kind: z.literal('source_version'),
    sourceVersionId: entityIdSchema,
  }),
]);
export type MediaOwner = z.infer<typeof mediaOwnerSchema>;
export const mediaKindSchema = z.enum(['photo', 'video', 'audio', 'document']);
export type MediaKind = z.infer<typeof mediaKindSchema>;
export const mediaPurposeSchema = z.enum([
  'object',
  'receipt',
  'voice_note',
  'book_page',
  'book_file',
]);
export type MediaPurpose = z.infer<typeof mediaPurposeSchema>;
export const mediaStateSchema = z.enum([
  'awaiting_upload',
  'uploaded',
  'processing',
  'ready',
  'failed',
]);
export type MediaState = z.infer<typeof mediaStateSchema>;
export const signedReadSchema = z.strictObject({
  assetOrDerivativeId: entityIdSchema,
  url: z.url(),
  expiresAt: instantSchema,
});
export type SignedRead = z.infer<typeof signedReadSchema>;
export const mediaAssetSchema = z.strictObject({
  id: entityIdSchema,
  owner: mediaOwnerSchema,
  kind: mediaKindSchema,
  purpose: mediaPurposeSchema,
  state: mediaStateSchema,
  componentIds: z.array(entityIdSchema),
  originalFileName: z.string(),
  mimeType: z.string(),
  byteLength: z.int().nonnegative(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/i),
  durationMs: z.number().nonnegative().nullable(),
  views: z.array(canonicalViewSchema),
  createdAt: instantSchema,
});
export type MediaAsset = z.infer<typeof mediaAssetSchema>;
export const mediaDetailSchema = z.strictObject({
  asset: mediaAssetSchema,
  reads: z.array(signedReadSchema),
  anchors: z.array(evidenceAnchorSchema),
  processingJobId: entityIdSchema.nullable(),
  versions: recordVersionsSchema.nullable(),
});
export type MediaDetail = z.infer<typeof mediaDetailSchema>;
export const uploadRequestSchema = z.strictObject({
  requestKey: entityIdSchema,
  target: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('record'), recordId: entityIdSchema }),
    z.strictObject({
      kind: z.literal('source_intake'),
      intakeKey: entityIdSchema,
    }),
  ]),
  kind: mediaKindSchema,
  purpose: mediaPurposeSchema,
  componentIds: z.array(entityIdSchema),
  fileName: z.string(),
  mimeType: z.string(),
  byteLength: z.int().positive(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/i),
});
export type UploadRequest = z.infer<typeof uploadRequestSchema>;
const uploadBase = { assetId: entityIdSchema, expiresAt: instantSchema };
export const uploadSessionSchema = z.discriminatedUnion('mode', [
  z.strictObject({
    ...uploadBase,
    mode: z.literal('single'),
    putUrl: z.url(),
    headers: z.record(z.string(), z.string()),
  }),
  z.strictObject({
    ...uploadBase,
    mode: z.literal('multipart'),
    uploadId: z.string(),
    parts: z.array(
      z.strictObject({
        partNumber: z.int().positive(),
        offset: z.int().nonnegative(),
        byteLength: z.int().positive(),
        putUrl: z.url(),
        headers: z.record(z.string(), z.string()),
      }),
    ),
  }),
]);
export type UploadSession = z.infer<typeof uploadSessionSchema>;
export const completeUploadRequestSchema = z.strictObject({
  requestKey: entityIdSchema,
  parts: z
    .array(z.strictObject({ partNumber: z.int().positive(), etag: z.string() }))
    .optional(),
});
export type CompleteUploadRequest = z.infer<typeof completeUploadRequestSchema>;
export const mediaCompletionSchema = z.strictObject({
  assetId: entityIdSchema,
  state: mediaStateSchema,
  processingJobId: entityIdSchema.nullable(),
});
export type MediaCompletion = z.infer<typeof mediaCompletionSchema>;
export const evidenceCreateRequestSchema = z.discriminatedUnion('mode', [
  z.strictObject({
    requestKey: entityIdSchema,
    mode: z.literal('create'),
    checkId: entityIdSchema.optional(),
    evidence: evidenceInputSchema,
  }),
  z.strictObject({
    requestKey: entityIdSchema,
    mode: z.literal('prepare_frame'),
    recordId: entityIdSchema,
    originalAssetId: entityIdSchema,
    requestedTimeMs: z.number().nonnegative(),
  }),
]);
export type EvidenceCreateRequest = z.infer<typeof evidenceCreateRequestSchema>;
export const evidenceCreationSchema = z.union([
  evidenceAnchorSchema,
  jobEnvelopeSchema(z.unknown()),
]);
export type EvidenceCreation = z.infer<typeof evidenceCreationSchema>;
export const preparedFrameResultSchema = z.strictObject({
  originalAssetId: entityIdSchema,
  frame: frameLocatorSchema,
  view: canonicalViewSchema,
});
export type PreparedFrameResult = z.infer<typeof preparedFrameResultSchema>;
export const frameJobResultSchema = z.union([
  z.strictObject({ requestedTimeMs: z.number().nonnegative() }),
  preparedFrameResultSchema,
]);
export type FrameJobResult = z.infer<typeof frameJobResultSchema>;
export const preparedFrameSchema = preparedFrameResultSchema.safeExtend({
  reads: z.array(signedReadSchema),
});
export type PreparedFrame = z.infer<typeof preparedFrameSchema>;
export * from './media-observation.js';
export type { Region };
