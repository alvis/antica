import { sql } from 'drizzle-orm';
import {
  check,
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
import { evidenceAnchors, observations, recordChecks } from './evidence.js';
import { mediaAssets } from './media.js';
import { records } from './records.js';
import { jobs } from './runtime.js';

import type { ModelFailureAudit } from '@antica/contracts';

const instant = (name: string) =>
  timestamp(name, { withTimezone: true, mode: 'string' });

export const analysisSnapshots = pgTable(
  'analysis_snapshots',
  {
    id: uuid('id').primaryKey(),
    ownerId: text('owner_id').notNull(),
    recordId: uuid('record_id')
      .notNull()
      .references(() => records.id),
    recordRevision: integer('record_revision').notNull(),
    analysisInputVersion: integer('analysis_input_version').notNull(),
    evidenceVersion: integer('evidence_version').notNull(),
    content: jsonb('content').notNull(),
    contentHash: text('content_hash').notNull(),
    createdAt: instant('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('analysis_snapshots_record_idx').on(
      table.ownerId,
      table.recordId,
      table.createdAt,
    ),
  ],
);

export const snapshotAssets = pgTable(
  'snapshot_assets',
  {
    snapshotId: uuid('snapshot_id')
      .notNull()
      .references(() => analysisSnapshots.id),
    assetId: uuid('asset_id')
      .notNull()
      .references(() => mediaAssets.id),
  },
  (table) => [primaryKey({ columns: [table.snapshotId, table.assetId] })],
);

export const snapshotEvidence = pgTable(
  'snapshot_evidence',
  {
    snapshotId: uuid('snapshot_id')
      .notNull()
      .references(() => analysisSnapshots.id),
    anchorId: uuid('anchor_id')
      .notNull()
      .references(() => evidenceAnchors.id),
  },
  (table) => [primaryKey({ columns: [table.snapshotId, table.anchorId] })],
);

export const snapshotObservations = pgTable(
  'snapshot_observations',
  {
    snapshotId: uuid('snapshot_id')
      .notNull()
      .references(() => analysisSnapshots.id),
    observationId: uuid('observation_id')
      .notNull()
      .references(() => observations.id),
  },
  (table) => [primaryKey({ columns: [table.snapshotId, table.observationId] })],
);

export const snapshotChecks = pgTable(
  'snapshot_checks',
  {
    snapshotId: uuid('snapshot_id')
      .notNull()
      .references(() => analysisSnapshots.id),
    checkId: uuid('check_id')
      .notNull()
      .references(() => recordChecks.id),
  },
  (table) => [primaryKey({ columns: [table.snapshotId, table.checkId] })],
);

export const retrievalSnapshots = pgTable('retrieval_snapshots', {
  id: uuid('id').primaryKey(),
  ownerId: text('owner_id').notNull(),
  indexVersionId: uuid('index_version_id'),
  immutablePack: jsonb('immutable_pack').notNull(),
  contentHash: text('content_hash').notNull(),
  createdAt: instant('created_at').defaultNow().notNull(),
});

export const analysisRuns = pgTable(
  'analysis_runs',
  {
    id: uuid('id').primaryKey(),
    ownerId: text('owner_id').notNull(),
    recordId: uuid('record_id')
      .notNull()
      .references(() => records.id),
    jobId: uuid('job_id')
      .notNull()
      .references(() => jobs.id),
    snapshotId: uuid('snapshot_id')
      .notNull()
      .references(() => analysisSnapshots.id),
    retrievalSnapshotId: uuid('retrieval_snapshot_id').references(
      () => retrievalSnapshots.id,
    ),
    status: text('status').notNull(),
    requestedModelId: text('requested_model_id'),
    effectiveModelId: text('effective_model_id'),
    modelSelection: jsonb('model_selection').notNull(),
    input: jsonb('input'),
    profileVersion: text('profile_version').notNull(),
    promptVersion: text('prompt_version').notNull(),
    schemaVersion: text('schema_version').notNull(),
    providerVersion: text('provider_version'),
    audit: jsonb('audit'),
    failureAudits: jsonb('failure_audits')
      .$type<readonly ModelFailureAudit[]>()
      .notNull()
      .default([]),
    rawOutput: jsonb('raw_output'),
    createdAt: instant('created_at').defaultNow().notNull(),
    completedAt: instant('completed_at'),
  },
  (table) => [
    uniqueIndex('analysis_runs_job_uq').on(table.jobId),
    index('analysis_runs_record_idx').on(
      table.ownerId,
      table.recordId,
      table.createdAt,
      table.id,
    ),
  ],
);

export const runSuggestedMethods = pgTable(
  'run_suggested_methods',
  {
    runId: uuid('run_id')
      .notNull()
      .references(() => analysisRuns.id),
    methodId: uuid('method_id').notNull(),
    methodVersionId: uuid('method_version_id').notNull(),
    owningEntryId: uuid('owning_entry_id').notNull(),
    titleZhHant: text('title_zh_hant').notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.runId, table.methodId, table.methodVersionId],
    }),
  ],
);

export const claims = pgTable(
  'claims',
  {
    id: uuid('id').primaryKey(),
    runId: uuid('run_id')
      .notNull()
      .references(() => analysisRuns.id),
    kind: text('kind').notNull(),
    text: text('text').notNull(),
    relation: text('relation').notNull(),
    certainty: text('certainty').notNull(),
  },
  (table) => [uniqueIndex('claims_run_id_uq').on(table.runId, table.id)],
);

export const claimEvidence = pgTable(
  'claim_evidence',
  {
    claimId: uuid('claim_id')
      .notNull()
      .references(() => claims.id),
    anchorId: uuid('anchor_id')
      .notNull()
      .references(() => evidenceAnchors.id),
  },
  (table) => [primaryKey({ columns: [table.claimId, table.anchorId] })],
);

export const claimObservations = pgTable(
  'claim_observations',
  {
    claimId: uuid('claim_id')
      .notNull()
      .references(() => claims.id),
    observationId: uuid('observation_id')
      .notNull()
      .references(() => observations.id),
  },
  (table) => [primaryKey({ columns: [table.claimId, table.observationId] })],
);

export const claimCitations = pgTable(
  'claim_citations',
  {
    claimId: uuid('claim_id')
      .notNull()
      .references(() => claims.id),
    citationId: uuid('citation_id').notNull(),
  },
  (table) => [primaryKey({ columns: [table.claimId, table.citationId] })],
);

export const nextActions = pgTable(
  'next_actions',
  {
    id: uuid('id').primaryKey(),
    runId: uuid('run_id')
      .notNull()
      .references(() => analysisRuns.id),
    recordId: uuid('record_id')
      .notNull()
      .references(() => records.id),
    kind: text('kind').notNull(),
    instruction: text('instruction').notNull(),
    reason: text('reason').notNull(),
    checkId: uuid('check_id').references(() => recordChecks.id),
  },
  (table) => [uniqueIndex('next_actions_run_id_uq').on(table.runId, table.id)],
);

export const actionStates = pgTable(
  'action_states',
  {
    runId: uuid('run_id')
      .notNull()
      .references(() => analysisRuns.id),
    actionId: uuid('action_id')
      .notNull()
      .references(() => nextActions.id),
    recordId: uuid('record_id')
      .notNull()
      .references(() => records.id),
    revision: integer('revision').notNull().default(1),
    status: text('status').notNull(),
    latestResolutionId: uuid('latest_resolution_id'),
    updatedAt: instant('updated_at').defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.runId, table.actionId] })],
);

export const actionResolutions = pgTable(
  'action_resolutions',
  {
    id: uuid('id').primaryKey(),
    runId: uuid('run_id')
      .notNull()
      .references(() => analysisRuns.id),
    actionId: uuid('action_id')
      .notNull()
      .references(() => nextActions.id),
    actionRevision: integer('action_revision').notNull(),
    recordRevision: integer('record_revision').notNull(),
    status: text('status').notNull(),
    reason: text('reason'),
    onSiteDescription: text('on_site_description'),
    createdAt: instant('created_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('action_resolutions_revision_uq').on(
      table.runId,
      table.actionId,
      table.actionRevision,
    ),
  ],
);

export const resolutionEvidence = pgTable(
  'resolution_evidence',
  {
    resolutionId: uuid('resolution_id')
      .notNull()
      .references(() => actionResolutions.id),
    anchorId: uuid('anchor_id')
      .notNull()
      .references(() => evidenceAnchors.id),
  },
  (table) => [primaryKey({ columns: [table.resolutionId, table.anchorId] })],
);

export const resolutionObservations = pgTable(
  'resolution_observations',
  {
    resolutionId: uuid('resolution_id')
      .notNull()
      .references(() => actionResolutions.id),
    observationId: uuid('observation_id')
      .notNull()
      .references(() => observations.id),
  },
  (table) => [
    primaryKey({ columns: [table.resolutionId, table.observationId] }),
  ],
);

export const resolutionReferences = pgTable(
  'resolution_references',
  {
    resolutionId: uuid('resolution_id')
      .notNull()
      .references(() => actionResolutions.id),
    referenceId: uuid('reference_id').notNull(),
  },
  (table) => [primaryKey({ columns: [table.resolutionId, table.referenceId] })],
);

export const resolutionChecks = pgTable(
  'resolution_checks',
  {
    resolutionId: uuid('resolution_id')
      .notNull()
      .references(() => actionResolutions.id),
    checkId: uuid('check_id')
      .notNull()
      .references(() => recordChecks.id),
  },
  (table) => [primaryKey({ columns: [table.resolutionId, table.checkId] })],
);

export const proposals = pgTable(
  'proposals',
  {
    id: uuid('id').primaryKey(),
    runId: uuid('run_id')
      .notNull()
      .references(() => analysisRuns.id),
    field: text('field').notNull(),
    before: jsonb('before').notNull(),
    proposed: jsonb('proposed').notNull(),
  },
  (table) => [uniqueIndex('proposals_run_id_uq').on(table.runId, table.id)],
);

export const proposalFindings = pgTable(
  'proposal_findings',
  {
    proposalId: uuid('proposal_id')
      .notNull()
      .references(() => proposals.id),
    claimId: uuid('claim_id')
      .notNull()
      .references(() => claims.id),
  },
  (table) => [primaryKey({ columns: [table.proposalId, table.claimId] })],
);

export const proposalStates = pgTable(
  'proposal_states',
  {
    runId: uuid('run_id')
      .notNull()
      .references(() => analysisRuns.id),
    proposalId: uuid('proposal_id')
      .notNull()
      .references(() => proposals.id),
    status: text('status').notNull(),
    latestEventId: uuid('latest_event_id'),
  },
  (table) => [primaryKey({ columns: [table.runId, table.proposalId] })],
);

export const adoptionEvents = pgTable(
  'adoption_events',
  {
    id: uuid('id').primaryKey(),
    runId: uuid('run_id')
      .notNull()
      .references(() => analysisRuns.id),
    proposalId: uuid('proposal_id')
      .notNull()
      .references(() => proposals.id),
    status: text('status').notNull(),
    recordRevision: integer('record_revision').notNull(),
    createdAt: instant('created_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('adoption_events_proposal_uq').on(
      table.runId,
      table.proposalId,
    ),
    check(
      'adoption_events_status_ck',
      sql`${table.status} in ('accepted','skipped')`,
    ),
  ],
);
