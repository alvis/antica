import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

import {
  createTransactionPort,
  listResolvedProviderWebhooks,
  markProviderWebhookDelivered,
  recordVerifiedProviderWebhook,
} from '@antica/platform';

import type { OperationResult } from '@antica/application/ports';
import type { Database } from '@antica/platform';

interface SignedLlamaEvent {
  readonly eventId: string;
  readonly eventType: string;
  readonly timestamp: number;
  readonly providerJobId: string;
  readonly payload: Record<string, unknown>;
}

/**
 * Verifies LlamaParse's documented LC-Signature over the raw bytes before storage.
 * @param db
 * @param signingSecret
 * @param now
 */
export function createLlamaWebhookReceiver(
  db: Database,
  signingSecret: string,
  now: () => string,
): (request: Request) => Promise<Response> {
  if (!signingSecret) {
    throw new Error('Llama webhook signing secret is required');
  }

  return async (request) => {
    const body = await readBoundedBody(request, 1_048_576);
    if (!body) {
      return Response.json(
        { error: 'Webhook body too large' },
        { status: 413 },
      );
    }
    const signature = request.headers.get('LC-Signature');
    if (!signature || !/^sha256=[0-9a-f]{64}$/i.test(signature)) {
      return Response.json(
        { error: 'Invalid webhook signature' },
        { status: 401 },
      );
    }
    const actual = Buffer.from(signature.slice(7), 'hex');
    const expected = createHmac('sha256', signingSecret).update(body).digest();
    if (
      actual.length !== expected.length ||
      !timingSafeEqual(actual, expected)
    ) {
      return Response.json(
        { error: 'Invalid webhook signature' },
        { status: 401 },
      );
    }
    let event: SignedLlamaEvent;
    try {
      const value: unknown = JSON.parse(
        new TextDecoder('utf-8', { fatal: true }).decode(body),
      );
      const parsed = parseEvent(value);
      if (!parsed) {
        return Response.json(
          { error: 'Invalid webhook event' },
          { status: 422 },
        );
      }
      event = parsed;
    } catch {
      return Response.json({ error: 'Invalid webhook event' }, { status: 422 });
    }
    const signedAtMs = event.timestamp * 1000;
    const nowMs = Date.parse(now());
    if (
      !Number.isFinite(nowMs) ||
      Math.abs(nowMs - signedAtMs) > 24 * 60 * 60_000
    ) {
      return Response.json({ error: 'Expired webhook event' }, { status: 401 });
    }
    try {
      const receipt = await recordVerifiedProviderWebhook(db, {
        provider: 'llama-parse',
        eventId: event.eventId,
        providerJobId: event.providerJobId,
        eventType: event.eventType,
        signedAt: new Date(signedAtMs).toISOString(),
        payloadHash: createHash('sha256').update(body).digest('hex'),
        payload: event.payload,
      });

      return Response.json(
        { accepted: true, replay: !receipt.inserted },
        { status: 202 },
      );
    } catch (error) {
      const status =
        error instanceof Error &&
        error.message === 'Provider event ID conflicts with another payload'
          ? 409
          : 503;

      return Response.json(
        {
          error:
            status === 409
              ? 'Webhook event ID conflict'
              : 'Webhook receipt could not be saved',
        },
        { status },
      );
    }
  };
}

/**
 * @param request
 * @param limit
 */
async function readBoundedBody(
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
    const chunk = part.value as Uint8Array;
    length += chunk.byteLength;
    if (length > limit) {
      await reader.cancel();

      return null;
    }
    chunks.push(chunk);
  }
  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return body;
}

/**
 * Resumes only trusted mapped source jobs; early callbacks stay in the inbox.
 * @param db
 * @param sourceHandler
 * @param now
 * @param limit
 */
export async function drainLlamaWebhooks(
  db: Database,
  sourceHandler: (
    ownerId: string,
    jobId: string,
  ) => Promise<OperationResult<void>>,
  now: () => string,
  limit = 100,
): Promise<{
  readonly inspected: number;
  readonly delivered: number;
  readonly deferred: number;
}> {
  const events = await listResolvedProviderWebhooks(db, limit);
  const transaction = createTransactionPort(db);
  let delivered = 0;
  for (const event of events) {
    if (event.provider !== 'llama-parse' || !event.step.startsWith('parse:')) {
      continue;
    }
    try {
      const result = await sourceHandler(event.ownerId, event.jobId);
      if (!result.success) {
        continue;
      }
      const settled = await transaction.run(event.ownerId, async (unit) => {
        const step = await unit.jobs.getStep(event.jobId, event.step);
        const job = await unit.jobs.get(event.jobId);

        return {
          success: true as const,
          data:
            step?.state === 'completed' ||
            job?.state.kind === 'succeeded' ||
            job?.state.kind === 'partial' ||
            job?.state.kind === 'failed',
        };
      });
      if (!settled.data) {
        continue;
      }
      if (
        await markProviderWebhookDelivered(
          db,
          event.provider,
          event.eventId,
          now(),
        )
      ) {
        delivered += 1;
      }
    } catch {
      // The persisted inbox entry remains available to the next one-shot drain.
    }
  }

  return {
    inspected: events.length,
    delivered,
    deferred: events.length - delivered,
  };
}

/** @param value */
function parseEvent(value: unknown): SignedLlamaEvent | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const payload = value as Record<string, unknown>;
  const eventId = payload.event_id;
  const eventType = payload.event_type;
  const timestamp = payload.timestamp;
  const rawData = payload.data;
  if (
    typeof eventId !== 'string' ||
    !eventId ||
    typeof eventType !== 'string' ||
    !eventType ||
    typeof timestamp !== 'number' ||
    !Number.isFinite(timestamp)
  ) {
    return null;
  }
  if (!rawData || typeof rawData !== 'object') {
    return null;
  }
  const providerJobId = (rawData as Record<string, unknown>).job_id;
  if (typeof providerJobId !== 'string' || !providerJobId) {
    return null;
  }

  return { eventId, eventType, timestamp, providerJobId, payload };
}
