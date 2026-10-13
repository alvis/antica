import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { mediaAssets } from './media.js';
import { records } from './records.js';
import { jobs } from './runtime.js';

const instant = (name: string) =>
  timestamp(name, { withTimezone: true, mode: 'string' });

/** Immutable provider output is separate from explicit collector confirmation. */
export const transcriptionRuns = pgTable(
  'transcription_runs',
  {
    id: uuid('id').primaryKey(),
    ownerId: text('owner_id').notNull(),
    jobId: uuid('job_id')
      .notNull()
      .references(() => jobs.id),
    recordId: uuid('record_id')
      .notNull()
      .references(() => records.id),
    audioAssetId: uuid('audio_asset_id')
      .notNull()
      .references(() => mediaAssets.id),
    revision: integer('revision').notNull(),
    status: text('status').notNull(),
    snapshot: jsonb('snapshot').notNull(),
    request: jsonb('request').notNull(),
    modelSelection: jsonb('model_selection').notNull(),
    result: jsonb('result'),
    invocation: jsonb('invocation'),
    confirmedObservationId: uuid('confirmed_observation_id'),
    createdAt: instant('created_at').notNull(),
    updatedAt: instant('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('transcription_runs_owner_id_uq').on(table.ownerId, table.id),
    uniqueIndex('transcription_runs_job_uq').on(table.jobId),
    index('transcription_runs_record_idx').on(
      table.ownerId,
      table.recordId,
      table.createdAt,
    ),
    check(
      'transcription_runs_status_ck',
      sql`${table.status} in ('pending','ready','confirmed')`,
    ),
  ],
);

/** Frozen record/source inputs and generated proposals remain available after selective application. */
export const editDraftRuns = pgTable(
  'edit_draft_runs',
  {
    id: uuid('id').primaryKey(),
    ownerId: text('owner_id').notNull(),
    jobId: uuid('job_id')
      .notNull()
      .references(() => jobs.id),
    recordId: uuid('record_id')
      .notNull()
      .references(() => records.id),
    revision: integer('revision').notNull(),
    status: text('status').notNull(),
    snapshot: jsonb('snapshot').notNull(),
    request: jsonb('request').notNull(),
    modelSelection: jsonb('model_selection').notNull(),
    result: jsonb('result'),
    invocation: jsonb('invocation'),
    appliedProposalIds: jsonb('applied_proposal_ids')
      .notNull()
      .default(sql`'[]'::jsonb`),
    createdAt: instant('created_at').notNull(),
    updatedAt: instant('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('edit_draft_runs_owner_id_uq').on(table.ownerId, table.id),
    uniqueIndex('edit_draft_runs_job_uq').on(table.jobId),
    index('edit_draft_runs_record_idx').on(
      table.ownerId,
      table.recordId,
      table.createdAt,
    ),
    check(
      'edit_draft_runs_status_ck',
      sql`${table.status} in ('pending','ready','partially_applied','applied')`,
    ),
  ],
);

/** Stores the actual comparison result and exact invocation returned by the adapter. */
export const comparisonResults = pgTable(
  'comparison_results',
  {
    id: uuid('id').primaryKey(),
    ownerId: text('owner_id').notNull(),
    value: jsonb('value').notNull(),
    invocation: jsonb('invocation'),
    createdAt: instant('created_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('comparison_results_owner_id_uq').on(table.ownerId, table.id),
  ],
);

/** Keeps rejected generated output and model audit without presenting it as a successful comparison. */
export const comparisonFailures = pgTable(
  'comparison_failures',
  {
    id: uuid('id').primaryKey(),
    ownerId: text('owner_id').notNull(),
    query: jsonb('query').notNull(),
    error: jsonb('error').notNull(),
    audit: jsonb('audit').notNull(),
    createdAt: instant('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('comparison_failures_owner_id_uq').on(table.ownerId, table.id),
  ],
);
