import { randomUUID } from 'node:crypto';

import type { Context } from 'hono';

import type { OperationResult } from '@antica/application/ports';
import type { PublicError } from '@antica/contracts';

import type { ContentfulStatusCode } from 'hono/utils/http-status';

const maxJsonBytes = 1_048_576;
const successStatuses = { ok: 200, created: 201, accepted: 202 } as const;
type SuccessStatus = (typeof successStatuses)[keyof typeof successStatuses];

/** binds the authenticated owner ID to each protected Hono request */
export type ApiEnv = Record<'Variables', { ownerId: string }>;

/**
 * parses JSON while enforcing the one MiB request-body limit
 * @param context Hono context carrying the incoming request stream
 * @returns parsed JSON value for subsequent schema validation
 * @throws {RequestBodyError} when declared or streamed bytes exceed one MiB
 * @throws {SyntaxError} when the request has no body
 */
export async function jsonBody(context: Context): Promise<unknown> {
  const length = Number(context.req.header('content-length') ?? 0);
  if (length > maxJsonBytes) {
    throw new RequestBodyError();
  }
  const body = context.req.raw.body;
  if (body === null) {
    throw new SyntaxError('Missing JSON body');
  }
  const reader: ReadableStreamDefaultReader<Uint8Array> = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const result = await reader.read();
    if (result.done) {
      break;
    }
    total += result.value.byteLength;
    if (total > maxJsonBytes) {
      await reader.cancel();
      throw new RequestBodyError();
    }
    chunks.push(result.value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
}

/**
 * maps a result to its success or public-error HTTP status
 * @param context Hono response context
 * @param result application result to serialize
 * @param successStatus status used only when the result succeeds
 * @returns JSON response with a request ID on public errors
 */
export function respond<T>(
  context: Context,
  result: OperationResult<T>,
  successStatus: SuccessStatus = successStatuses.ok,
): Response {
  if (result.success) {
    return context.json(result.data, successStatus);
  }
  const error: PublicError = { ...result.error, requestId: randomUUID() };
  const status = statusFor(error.code);

  return context.json(error, status);
}

/**
 * returns the stable public response for invalid request input
 * @param context Hono response context
 * @param field optional input field associated with the failure
 * @returns HTTP 422 response with a new request ID
 */
export function invalid(context: Context, field?: string): Response {
  return context.json(
    {
      code: 'VALIDATION_FAILED',
      message: 'Request failed validation',
      retryable: false,
      requestId: randomUUID(),
      field,
    },
    statusByCode.VALIDATION_FAILED,
  );
}

/** signals a JSON body that exceeds the request-size limit */
export class RequestBodyError extends Error {}

const statusByCode = {
  AUTH_REQUIRED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  RATE_LIMITED: 429,
  REVISION_CONFLICT: 409,
  REQUEST_IN_PROGRESS: 409,
  UPLOAD_INCOMPLETE: 409,
  INDEX_NOT_READY: 409,
  VALIDATION_FAILED: 422,
  EVIDENCE_INVALID: 422,
  MEDIA_UNSUPPORTED: 422,
  MODEL_CAPABILITY_MISMATCH: 422,
  MODEL_UNKNOWN: 422,
  PROVIDER_UNAVAILABLE: 503,
  SOURCE_UNAVAILABLE: 503,
  JOB_FAILED: 503,
  MODEL_OUTPUT_INVALID: 500,
  OTP_INVALID: 401,
  OTP_EXPIRED: 410,
} satisfies Record<PublicError['code'], ContentfulStatusCode>;

/**
 * finds the HTTP status for a public operation error
 * @param code public operation error code
 * @returns HTTP response status
 */
function statusFor(code: PublicError['code']): ContentfulStatusCode {
  return statusByCode[code];
}
