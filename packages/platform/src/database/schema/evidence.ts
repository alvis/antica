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
import { canonicalViews, mediaAssets, mediaDerivatives } from './media.js';
import { recordComponents, records } from './records.js';

const instant = (name: string) =>
  timestamp(name, { withTimezone: true, mode: 'string' });

export const evidenceAnchors = pgTable(
  'evidence_anchors',
  {
    id: uuid('id').primaryKey(),
    ownerId: text('owner_id').notNull(),
    recordId: uuid('record_id')
      .notNull()
      .references(() => records.id),
    originalAssetId: uuid('original_asset_id')
      .notNull()
      .references(() => mediaAssets.id),
    canonicalViewId: uuid('canonical_view_id')
      .notNull()
      .references(() => canonicalViews.id),
    kind: text('kind').notNull(),
    scopeKind: text('scope_kind').notNull(),
    region: jsonb('region'),
    cropDerivativeId: uuid('crop_derivative_id').references(
      () => mediaDerivatives.id,
    ),
    frameStreamIndex: integer('frame_stream_index'),
    frameTimebaseNumerator: integer('frame_timebase_numerator'),
    frameTimebaseDenominator: integer('frame_timebase_denominator'),
    framePts: text('frame_pts'),
    frameDerivativeId: uuid('frame_derivative_id').references(
      () => mediaDerivatives.id,
    ),
    frameDisplayTimeMs: integer('frame_display_time_ms'),
    createdAt: instant('created_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('evidence_anchors_owner_record_id_uq').on(
      table.ownerId,
      table.recordId,
      table.id,
    ),
    index('evidence_anchors_record_idx').on(
      table.ownerId,
      table.recordId,
      table.createdAt,
      table.id,
    ),
    check(
      'evidence_anchor_scope_ck',
      sql`(${table.scopeKind} = 'whole' and ${table.region} is null) or (${table.scopeKind} = 'region' and ${table.region} is not null)`,
    ),
  ],
);

export const anchorComponents = pgTable(
  'anchor_components',
  {
    anchorId: uuid('anchor_id')
      .notNull()
      .references(() => evidenceAnchors.id),
    componentId: uuid('component_id')
      .notNull()
      .references(() => recordComponents.id),
  },
  (table) => [primaryKey({ columns: [table.anchorId, table.componentId] })],
);

export const observations = pgTable(
  'observations',
  {
    id: uuid('id').primaryKey(),
    ownerId: text('owner_id').notNull(),
    recordId: uuid('record_id')
      .notNull()
      .references(() => records.id),
    channel: text('channel').notNull(),
    text: text('text').notNull(),
    observedAt: instant('observed_at').notNull(),
    audioAssetId: uuid('audio_asset_id').references(() => mediaAssets.id),
    transcriptionId: uuid('transcription_id'),
    segmentId: uuid('segment_id'),
    editDraftId: uuid('edit_draft_id'),
    supersedesId: uuid('supersedes_id'),
    supersededById: uuid('superseded_by_id'),
    createdAt: instant('created_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('observations_owner_record_id_uq').on(
      table.ownerId,
      table.recordId,
      table.id,
    ),
    uniqueIndex('observations_supersedes_uq').on(table.supersedesId),
    uniqueIndex('observations_superseded_by_uq').on(table.supersededById),
    index('observations_current_idx')
      .on(table.ownerId, table.recordId, table.createdAt, table.id)
      .where(sql`${table.supersededById} is null`),
  ],
);

export const observationComponents = pgTable(
  'observation_components',
  {
    observationId: uuid('observation_id')
      .notNull()
      .references(() => observations.id),
    componentId: uuid('component_id')
      .notNull()
      .references(() => recordComponents.id),
  },
  (table) => [
    primaryKey({ columns: [table.observationId, table.componentId] }),
  ],
);

export const observationAnchors = pgTable(
  'observation_anchors',
  {
    observationId: uuid('observation_id')
      .notNull()
      .references(() => observations.id),
    anchorId: uuid('anchor_id')
      .notNull()
      .references(() => evidenceAnchors.id),
  },
  (table) => [primaryKey({ columns: [table.observationId, table.anchorId] })],
);

export const recordChecks = pgTable(
  'record_checks',
  {
    id: uuid('id').primaryKey(),
    ownerId: text('owner_id').notNull(),
    recordId: uuid('record_id')
      .notNull()
      .references(() => records.id),
    methodId: uuid('method_id').notNull(),
    methodVersionId: uuid('method_version_id').notNull(),
    scopeKey: text('scope_key').notNull(),
    revision: integer('revision').notNull().default(1),
    progress: text('progress').notNull().default('not_started'),
    resultKind: text('result_kind').notNull().default('unrecorded'),
    resultReason: text('result_reason'),
    suggestedByRunId: uuid('suggested_by_run_id'),
    createdAt: instant('created_at').defaultNow().notNull(),
    updatedAt: instant('updated_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('record_checks_scope_uq').on(
      table.recordId,
      table.methodVersionId,
      table.scopeKey,
    ),
    uniqueIndex('record_checks_owner_record_id_uq').on(
      table.ownerId,
      table.recordId,
      table.id,
    ),
    index('record_checks_owner_progress_idx').on(
      table.ownerId,
      table.progress,
      table.createdAt,
      table.id,
    ),
    check(
      'record_checks_reason_ck',
      sql`(${table.resultKind} in ('undetermined', 'not_applicable') and nullif(trim(${table.resultReason}), '') is not null) or (${table.resultKind} not in ('undetermined', 'not_applicable') and ${table.resultReason} is null)`,
    ),
  ],
);

export const checkComponents = pgTable(
  'check_components',
  {
    checkId: uuid('check_id')
      .notNull()
      .references(() => recordChecks.id),
    componentId: uuid('component_id')
      .notNull()
      .references(() => recordComponents.id),
  },
  (table) => [primaryKey({ columns: [table.checkId, table.componentId] })],
);

export const checkObservations = pgTable(
  'check_observations',
  {
    checkId: uuid('check_id')
      .notNull()
      .references(() => recordChecks.id),
    observationId: uuid('observation_id')
      .notNull()
      .references(() => observations.id),
  },
  (table) => [primaryKey({ columns: [table.checkId, table.observationId] })],
);

export const checkAnchors = pgTable(
  'check_anchors',
  {
    checkId: uuid('check_id')
      .notNull()
      .references(() => recordChecks.id),
    anchorId: uuid('anchor_id')
      .notNull()
      .references(() => evidenceAnchors.id),
  },
  (table) => [primaryKey({ columns: [table.checkId, table.anchorId] })],
);
