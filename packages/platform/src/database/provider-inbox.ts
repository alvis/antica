import { and, asc, eq, isNull } from 'drizzle-orm';
import type { Database } from './connection.js';
import {
  jobs,
  providerJobMappings,
  providerWebhookInbox,
} from './schema/index.js';

export interface VerifiedProviderWebhook {
  readonly provider: string;
  readonly eventId: string;
  readonly providerJobId: string;
  readonly eventType: string;
  readonly signedAt: string;
  readonly payloadHash: string;
  readonly payload: unknown;
}

/** Stores only an already signature-verified callback, even before its job mapping exists. */
export async function recordVerifiedProviderWebhook(
  db: Database,
  event: VerifiedProviderWebhook,
): Promise<{ readonly inserted: boolean }> {
  const [inserted] = await db
    .insert(providerWebhookInbox)
    .values(event)
    .onConflictDoNothing()
    .returning({ eventId: providerWebhookInbox.eventId });
  if (inserted) {
    return { inserted: true };
  }
  const [existing] = await db
    .select({
      hash: providerWebhookInbox.payloadHash,
      providerJobId: providerWebhookInbox.providerJobId,
    })
    .from(providerWebhookInbox)
    .where(
      and(
        eq(providerWebhookInbox.provider, event.provider),
        eq(providerWebhookInbox.eventId, event.eventId),
      ),
    );
  if (
    !existing ||
    existing.hash !== event.payloadHash ||
    existing.providerJobId !== event.providerJobId
  ) {
    throw new Error('Provider event ID conflicts with another payload');
  }
  return { inserted: false };
}

/** Resolves pending verified callbacks through trusted provider-job and job-owner rows. */
export async function listResolvedProviderWebhooks(
  db: Database,
  limit: number,
) {
  const rows = await db
    .select({
      event: providerWebhookInbox,
      jobId: providerJobMappings.jobId,
      step: providerJobMappings.stageKey,
      ownerId: jobs.ownerId,
    })
    .from(providerWebhookInbox)
    .innerJoin(
      providerJobMappings,
      and(
        eq(providerWebhookInbox.provider, providerJobMappings.provider),
        eq(
          providerWebhookInbox.providerJobId,
          providerJobMappings.providerJobId,
        ),
      ),
    )
    .innerJoin(jobs, eq(providerJobMappings.jobId, jobs.id))
    .where(isNull(providerWebhookInbox.deliveredAt))
    .orderBy(
      asc(providerWebhookInbox.createdAt),
      asc(providerWebhookInbox.eventId),
    )
    .limit(Math.min(Math.max(limit, 1), 100));
  return rows.map((row) => ({
    provider: row.event.provider,
    eventId: row.event.eventId,
    providerJobId: row.event.providerJobId,
    eventType: row.event.eventType,
    signedAt: new Date(row.event.signedAt).toISOString(),
    payload: row.event.payload,
    ownerId: row.ownerId,
    jobId: row.jobId,
    step: row.step,
  }));
}

/** Marks a callback delivered only after its owner-scoped handler succeeds. */
export async function markProviderWebhookDelivered(
  db: Database,
  provider: string,
  eventId: string,
  deliveredAt: string,
): Promise<boolean> {
  const [row] = await db
    .update(providerWebhookInbox)
    .set({ deliveredAt })
    .where(
      and(
        eq(providerWebhookInbox.provider, provider),
        eq(providerWebhookInbox.eventId, eventId),
        isNull(providerWebhookInbox.deliveredAt),
      ),
    )
    .returning({ eventId: providerWebhookInbox.eventId });
  return Boolean(row);
}
