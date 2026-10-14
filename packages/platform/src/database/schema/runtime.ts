import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const instant = (name: string) =>
  timestamp(name, { withTimezone: true, mode: 'string' });

export const jobs = pgTable(
  'jobs',
  {
    id: uuid('id').primaryKey(),
    ownerId: text('owner_id').notNull(),
    kind: text('kind').notNull(),
    resourceId: uuid('resource_id').notNull(),
    state: text('state').notNull(),
    stage: text('stage').notNull(),
    revision: integer('revision').notNull().default(1),
    createdAt: instant('created_at').defaultNow().notNull(),
    updatedAt: instant('updated_at').defaultNow().notNull(),
    completedAt: instant('completed_at'),
    error: jsonb('error'),
    result: jsonb('result'),
  },
  (table) => [
    uniqueIndex('jobs_owner_id_uq').on(table.ownerId, table.id),
    index('jobs_owner_state_idx').on(
      table.ownerId,
      table.state,
      table.createdAt,
    ),
  ],
);

export const jobSteps = pgTable(
  'job_steps',
  {
    jobId: uuid('job_id')
      .notNull()
      .references(() => jobs.id),
    stageKey: text('stage_key').notNull(),
    revision: integer('revision').notNull().default(1),
    state: text('state').notNull(),
    leaseToken: uuid('lease_token'),
    leaseUntil: instant('lease_until'),
    attempt: integer('attempt').notNull().default(0),
    checkpoint: jsonb('checkpoint'),
    result: jsonb('result'),
    updatedAt: instant('updated_at').defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.jobId, table.stageKey] }),
    index('job_steps_claim_idx').on(table.state, table.leaseUntil),
  ],
);

export const outbox = pgTable(
  'outbox',
  {
    eventId: uuid('event_id').primaryKey(),
    jobId: uuid('job_id').references(() => jobs.id),
    eventName: text('event_name').notNull(),
    schemaVersion: text('schema_version').notNull(),
    ownerId: text('owner_id').notNull(),
    resourceId: uuid('resource_id').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    payload: jsonb('payload').notNull(),
    attemptCount: integer('attempt_count').notNull().default(0),
    availableAt: instant('available_at').defaultNow().notNull(),
    leaseToken: uuid('lease_token'),
    leaseUntil: instant('lease_until'),
    deliveredAt: instant('delivered_at'),
    createdAt: instant('created_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('outbox_idempotency_uq').on(
      table.eventName,
      table.idempotencyKey,
    ),
    index('outbox_pending_idx')
      .on(table.availableAt, table.eventId)
      .where(sql`${table.deliveredAt} is null`),
  ],
);

export const idempotencyRequests = pgTable(
  'idempotency_requests',
  {
    ownerId: text('owner_id').notNull(),
    operation: text('operation').notNull(),
    key: uuid('key').notNull(),
    fingerprint: text('fingerprint').notNull(),
    status: text('status').notNull(),
    responseStatus: integer('response_status'),
    response: jsonb('response'),
    createdAt: instant('created_at').defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.ownerId, table.operation, table.key] }),
  ],
);

export const providerJobMappings = pgTable(
  'provider_job_mappings',
  {
    id: uuid('id').primaryKey(),
    provider: text('provider').notNull(),
    providerJobId: text('provider_job_id').notNull(),
    jobId: uuid('job_id')
      .notNull()
      .references(() => jobs.id),
    stageKey: text('stage_key').notNull(),
    correlationToken: text('correlation_token').notNull(),
    createdAt: instant('created_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('provider_job_mappings_provider_job_uq').on(
      table.provider,
      table.providerJobId,
    ),
    uniqueIndex('provider_job_mappings_token_uq').on(table.correlationToken),
  ],
);

export const providerEvents = pgTable(
  'provider_events',
  {
    provider: text('provider').notNull(),
    eventId: text('event_id').notNull(),
    mappingId: uuid('mapping_id')
      .notNull()
      .references(() => providerJobMappings.id),
    payloadHash: text('payload_hash').notNull(),
    payload: jsonb('payload').notNull(),
    receivedAt: instant('received_at').defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.provider, table.eventId] })],
);

/** verified callbacks are durable before provider-job correlation; early events wait for a mapping */
export const providerWebhookInbox = pgTable(
  'provider_webhook_inbox',
  {
    provider: text('provider').notNull(),
    eventId: text('event_id').notNull(),
    providerJobId: text('provider_job_id').notNull(),
    eventType: text('event_type').notNull(),
    signedAt: instant('signed_at').notNull(),
    payloadHash: text('payload_hash').notNull(),
    payload: jsonb('payload').notNull(),
    createdAt: instant('created_at').defaultNow().notNull(),
    deliveredAt: instant('delivered_at'),
  },
  (table) => [
    primaryKey({ columns: [table.provider, table.eventId] }),
    index('provider_webhook_inbox_pending_idx')
      .on(table.provider, table.createdAt)
      .where(sql`${table.deliveredAt} is null`),
  ],
);

export const providerCompletions = pgTable('provider_completions', {
  mappingId: uuid('mapping_id')
    .primaryKey()
    .references(() => providerJobMappings.id),
  result: jsonb('result').notNull(),
  completedAt: instant('completed_at').defaultNow().notNull(),
});

export const sequenceCounters = pgTable(
  'sequence_counters',
  {
    ownerId: text('owner_id').notNull(),
    kind: text('kind').notNull(),
    nextValue: integer('next_value').notNull().default(1),
  },
  (table) => [primaryKey({ columns: [table.ownerId, table.kind] })],
);
