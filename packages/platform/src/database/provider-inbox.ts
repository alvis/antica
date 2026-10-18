import { jsonValue } from './json.js';

import type { Database } from './connection.js';

/** provider callback accepted only after signature verification */
export interface VerifiedProviderWebhook {
  readonly provider: string;
  readonly eventId: string;
  readonly providerJobId: string;
  readonly eventType: string;
  readonly signedAt: string;
  readonly payloadHash: string;
  readonly payload: unknown;
}

/**
 * stores an already signature-verified callback, even before its job mapping exists
 * @param db platform database
 * @param event verified callback
 * @returns whether this delivery inserted the event
 */
export async function recordVerifiedProviderWebhook(
  db: Database,
  event: VerifiedProviderWebhook,
): Promise<{ readonly inserted: boolean }> {
  const inserted = await db.providerWebhookInbox.createMany({
    data: { ...event, payload: jsonValue(event.payload) },
    skipDuplicates: true,
  });
  if (inserted.count === 1) {
    return { inserted: true };
  }
  const existing = await db.providerWebhookInbox.findUnique({
    where: {
      provider_eventId: { provider: event.provider, eventId: event.eventId },
    },
    select: { payloadHash: true, providerJobId: true },
  });
  if (
    !existing ||
    existing.payloadHash !== event.payloadHash ||
    existing.providerJobId !== event.providerJobId
  ) {
    throw new Error('Provider event ID conflicts with another payload');
  }

  return { inserted: false };
}

/** resolved verified callback with its trusted owner and job */
export interface ResolvedProviderWebhook {
  readonly provider: string;
  readonly eventId: string;
  readonly providerJobId: string;
  readonly eventType: string;
  readonly signedAt: string;
  readonly payload: unknown;
  readonly ownerId: string;
  readonly jobId: string;
  readonly step: string;
}

/**
 * resolves pending callbacks through trusted provider-job and job-owner rows
 * @param db platform database
 * @param limit maximum callbacks, bounded to one hundred
 * @returns oldest pending callbacks whose job mapping exists
 */
export async function listResolvedProviderWebhooks(
  db: Database,
  limit: number,
): Promise<ResolvedProviderWebhook[]> {
  const rows = await db.$queryRaw<
    Array<Omit<ResolvedProviderWebhook, 'signedAt'> & { signedAt: Date }>
  >`
    select inbox.provider, inbox.event_id as "eventId", inbox.provider_job_id as "providerJobId",
      inbox.event_type as "eventType", inbox.signed_at as "signedAt", inbox.payload,
      job.owner_id as "ownerId", mapping.job_id as "jobId", mapping.stage_key as step
    from provider_webhook_inbox inbox
    inner join provider_job_mappings mapping
      on inbox.provider = mapping.provider and inbox.provider_job_id = mapping.provider_job_id
    inner join jobs job on mapping.job_id = job.id
    where inbox.delivered_at is null
    order by inbox.created_at, inbox.event_id
    limit ${Math.min(Math.max(limit, 1), 100)}`;

  return rows.map((row) => ({ ...row, signedAt: row.signedAt.toISOString() }));
}

/**
 * marks a callback delivered after its owner-scoped handler succeeds
 * @param db platform database
 * @param provider provider identity
 * @param eventId callback identity
 * @param deliveredAt successful delivery instant
 * @returns whether an undelivered callback changed
 */
export async function markProviderWebhookDelivered(
  db: Database,
  provider: string,
  eventId: string,
  deliveredAt: string,
): Promise<boolean> {
  const changed = await db.providerWebhookInbox.updateMany({
    data: { deliveredAt },
    where: { provider, eventId, deliveredAt: null },
  });

  return changed.count === 1;
}
