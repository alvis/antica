import { randomUUID } from 'node:crypto';

import type { Hono } from 'hono';

import type { ApiEnv } from './http.js';

const maximumUploadBytes = 100_000_000;
const payloadTooLargeStatus = 413;
const forbiddenStatus = 403;
const noContentStatus = 204;

/** verifies local signed transfers before accepting or releasing private bytes */
export interface LocalTransfers {
  readonly validateUploadToken: (
    token: string,
  ) => Promise<{ readonly byteLength: number; readonly mimeType: string }>;
  readonly acceptUploadToken: (
    token: string,
    bytes: Uint8Array,
    mimeType: string,
  ) => Promise<void>;
  readonly openReadToken: (
    token: string,
  ) => Promise<{ readonly bytes: Uint8Array; readonly mimeType: string }>;
}

/**
 * mounts bounded signed development-storage transfers
 * @param app application router
 * @param transfers signature-verifying local storage operations
 */
export function mountLocalTransfers(
  app: Hono<ApiEnv>,
  transfers: LocalTransfers,
): void {
  app.put('/v1/storage/uploads/:token', async (context) => {
    try {
      const token = context.req.param('token');
      const expected = await transfers.validateUploadToken(token);
      const bytes = await readBoundedUpload(
        context.req.raw,
        Math.min(expected.byteLength, maximumUploadBytes),
      );
      if (!bytes) {
        return context.json(
          {
            code: 'VALIDATION_FAILED',
            message: 'Upload exceeds declared size or development limit',
            retryable: false,
            requestId: randomUUID(),
          },
          payloadTooLargeStatus,
        );
      }
      await transfers.acceptUploadToken(
        token,
        bytes,
        context.req.header('content-type') ?? '',
      );

      return context.body(null, noContentStatus);
    } catch {
      return context.json(
        {
          code: 'UPLOAD_INCOMPLETE',
          message: 'Upload authorization or bytes invalid',
          retryable: false,
          requestId: randomUUID(),
        },
        forbiddenStatus,
      );
    }
  });
  mountLocalRead(app, transfers);
}

/**
 * mounts private reads using expiring signed authorization
 * @param app application router
 * @param transfers signature-verifying local storage operations
 */
function mountLocalRead(app: Hono<ApiEnv>, transfers: LocalTransfers): void {
  app.get('/v1/storage/reads/:token', async (context) => {
    try {
      const object = await transfers.openReadToken(context.req.param('token'));

      return new Response(Buffer.from(object.bytes), {
        headers: {
          'content-type': object.mimeType,
          'cache-control': 'no-store',
        },
      });
    } catch {
      return context.json(
        {
          code: 'FORBIDDEN',
          message: 'Read authorization invalid or expired',
          retryable: false,
          requestId: randomUUID(),
        },
        forbiddenStatus,
      );
    }
  });
}

/**
 * cancels excessive streams before retaining bytes past the declared limit
 * @param request incoming signed upload
 * @param limit smaller of authenticated declared size and development cap
 * @returns bounded upload bytes, or null once the limit is exceeded
 */
async function readBoundedUpload(
  request: Request,
  limit: number,
): Promise<Uint8Array | null> {
  const reader = request.body?.getReader();
  if (!reader) {
    return new Uint8Array();
  }
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const part = await reader.read();
    if (part.done) {
      break;
    }
    const chunk: unknown = part.value;
    if (!(chunk instanceof Uint8Array)) {
      throw new Error('Invalid upload chunk');
    }
    length += chunk.byteLength;
    if (length > limit) {
      await reader.cancel();

      return null;
    }
    chunks.push(chunk);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return bytes;
}
