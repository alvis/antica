import { z } from 'zod';

export const errorCodeSchema = z.enum([
  'AUTH_REQUIRED',
  'OTP_INVALID',
  'OTP_EXPIRED',
  'RATE_LIMITED',
  'FORBIDDEN',
  'NOT_FOUND',
  'VALIDATION_FAILED',
  'UPLOAD_INCOMPLETE',
  'MEDIA_UNSUPPORTED',
  'EVIDENCE_INVALID',
  'SOURCE_UNAVAILABLE',
  'INDEX_NOT_READY',
  'REVISION_CONFLICT',
  'REQUEST_IN_PROGRESS',
  'MODEL_UNKNOWN',
  'MODEL_CAPABILITY_MISMATCH',
  'MODEL_OUTPUT_INVALID',
  'PROVIDER_UNAVAILABLE',
  'JOB_FAILED',
]);
export type ErrorCode = z.infer<typeof errorCodeSchema>;
export const publicErrorSchema = z.strictObject({
  code: errorCodeSchema,
  message: z.string(),
  retryable: z.boolean(),
  requestId: z.string(),
  field: z.string().optional(),
});
export type PublicError = z.infer<typeof publicErrorSchema>;
