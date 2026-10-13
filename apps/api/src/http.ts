import { randomUUID } from 'node:crypto';

import type { Context } from 'hono';

import type { OperationResult } from '@antica/application/ports';
import type { PublicError } from '@antica/contracts';

import type { ContentfulStatusCode } from 'hono/utils/http-status';

const maxJsonBytes = 1_048_576;
const successStatuses = { ok: 200, created: 201, accepted: 202 } as const;
type SuccessStatus = (typeof successStatuses)[keyof typeof successStatuses];

export type ApiEnv = Record<'Variables', { ownerId: string }>;

/**
 * Parses a validated JSON request without accepting unbounded bodies.
 * @param context Incoming HTTP request.
 * @returns Parsed JSON value.
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
 * Maps an application result to its HTTP contract.
 * @param context Active HTTP response context.
 * @param result Application operation result.
 * @param successStatus Status for a successful operation.
 * @returns JSON response.
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
 * Returns a stable validation failure at the JSON boundary.
 * @param context Active HTTP response context.
 * @param field Optional field label.
 * @returns Validation error response.
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

/** rejects malformed requests without exposing parser details */
export class RequestBodyError extends Error {}

const statusByCode = {
  AUTH_REQUIRED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  RATE_LIMITED: 429,
  REVISION_CONFLICT: 409,
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
 * Finds the HTTP status for a public operation error.
 * @param code Public operation error code.
 * @returns HTTP response status.
 */
function statusFor(code: PublicError['code']): ContentfulStatusCode {
  return statusByCode[code];
}
