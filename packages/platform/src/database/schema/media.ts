import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { records, recordComponents } from './records.js';

const instant = (name: string) =>
  timestamp(name, { withTimezone: true, mode: 'string' });

export const sourceIntakes = pgTable('source_intakes', {
  id: uuid('id').primaryKey(),
  ownerId: text('owner_id').notNull(),
  createdAt: instant('created_at').defaultNow().notNull(),
});

export const mediaAssets = pgTable(
  'media_assets',
  {
    id: uuid('id').primaryKey(),
    ownerId: text('owner_id').notNull(),
    recordId: uuid('record_id').references(() => records.id),
    sourceIntakeId: uuid('source_intake_id').references(() => sourceIntakes.id),
    sourceVersionId: uuid('source_version_id'),
    kind: text('kind').notNull(),
    purpose: text('purpose').notNull(),
    state: text('state').notNull(),
    objectKey: text('object_key').notNull(),
    originalFileName: text('original_file_name').notNull(),
    mimeType: text('mime_type').notNull(),
    byteLength: bigint('byte_length', { mode: 'number' }).notNull(),
    sha256: text('sha256').notNull(),
    durationMs: numeric('duration_ms', { precision: 20, scale: 3 }),
    verifiedAt: instant('verified_at'),
    readyVersionAppliedAt: instant('ready_version_applied_at'),
    createdAt: instant('created_at').defaultNow().notNull(),
    updatedAt: instant('updated_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('media_assets_object_key_uq').on(table.objectKey),
    index('media_assets_record_idx').on(
      table.ownerId,
      table.recordId,
      table.createdAt,
    ),
    check(
      'media_assets_owner_xor_ck',
      sql`num_nonnulls(${table.recordId}, ${table.sourceIntakeId}, ${table.sourceVersionId}) = 1`,
    ),
    check('media_assets_sha256_ck', sql`${table.sha256} ~ '^[0-9a-f]{64}$'`),
    check('media_assets_bytes_ck', sql`${table.byteLength} > 0`),
  ],
);

export const mediaAssetComponents = pgTable(
  'media_asset_components',
  {
    assetId: uuid('asset_id')
      .notNull()
      .references(() => mediaAssets.id),
    componentId: uuid('component_id')
      .notNull()
      .references(() => recordComponents.id),
  },
  (table) => [primaryKey({ columns: [table.assetId, table.componentId] })],
);

export const uploadSessions = pgTable(
  'upload_sessions',
  {
    assetId: uuid('asset_id')
      .primaryKey()
      .references(() => mediaAssets.id),
    ownerId: text('owner_id').notNull(),
    requestKey: uuid('request_key').notNull(),
    fingerprint: text('fingerprint').notNull(),
    mode: text('mode').notNull(),
    signedSession: jsonb('signed_session').notNull(),
    providerUploadId: text('provider_upload_id'),
    expiresAt: instant('expires_at').notNull(),
    createdAt: instant('created_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('upload_sessions_owner_request_uq').on(
      table.ownerId,
      table.requestKey,
    ),
  ],
);

export const uploadParts = pgTable(
  'upload_parts',
  {
    assetId: uuid('asset_id')
      .notNull()
      .references(() => mediaAssets.id),
    partNumber: integer('part_number').notNull(),
    etag: text('etag'),
    offset: bigint('offset', { mode: 'number' }).notNull(),
    byteLength: bigint('byte_length', { mode: 'number' }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.assetId, table.partNumber] }),
    check(
      'upload_parts_length_ck',
      sql`${table.byteLength} > 0 and ${table.offset} >= 0`,
    ),
  ],
);

export const mediaDerivatives = pgTable(
  'media_derivatives',
  {
    id: uuid('id').primaryKey(),
    ownerId: text('owner_id').notNull(),
    originalAssetId: uuid('original_asset_id')
      .notNull()
      .references(() => mediaAssets.id),
    kind: text('kind').notNull(),
    objectKey: text('object_key').notNull(),
    mimeType: text('mime_type').notNull(),
    byteLength: bigint('byte_length', { mode: 'number' }).notNull(),
    sha256: text('sha256').notNull(),
    width: integer('width'),
    height: integer('height'),
    parentViewId: uuid('parent_view_id'),
    parentDerivativeId: uuid('parent_derivative_id'),
    region: jsonb('region'),
    transform: jsonb('transform'),
    streamIndex: integer('stream_index'),
    pts: numeric('pts', { precision: 20, scale: 0 }),
    timebaseNumerator: integer('timebase_numerator'),
    timebaseDenominator: integer('timebase_denominator'),
    displayTimeMs: numeric('display_time_ms', { precision: 20, scale: 3 }),
    createdAt: instant('created_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('media_derivatives_key_uq').on(table.objectKey),
    index('media_derivatives_original_idx').on(
      table.originalAssetId,
      table.kind,
    ),
  ],
);

export const canonicalViews = pgTable(
  'canonical_views',
  {
    id: uuid('id').primaryKey(),
    originalAssetId: uuid('original_asset_id')
      .notNull()
      .references(() => mediaAssets.id),
    derivativeId: uuid('derivative_id').references(() => mediaDerivatives.id),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    coordinateSpace: text('coordinate_space').notNull(),
    transformToOriginal: jsonb('transform_to_original').notNull(),
  },
  (table) => [
    uniqueIndex('canonical_views_derivative_uq').on(table.derivativeId),
    check(
      'canonical_views_dimensions_ck',
      sql`${table.width} > 0 and ${table.height} > 0`,
    ),
  ],
);
