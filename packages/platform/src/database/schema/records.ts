import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const instant = (name: string) =>
  timestamp(name, { withTimezone: true, mode: 'string' });

export const locations = pgTable(
  'locations',
  {
    id: uuid('id').primaryKey(),
    ownerId: text('owner_id').notNull(),
    label: text('label').notNull(),
    normalizedLabel: text('normalized_label').notNull(),
    createdAt: instant('created_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('locations_owner_label_uq').on(
      table.ownerId,
      table.normalizedLabel,
    ),
  ],
);

export const records = pgTable(
  'records',
  {
    id: uuid('id').primaryKey(),
    ownerId: text('owner_id').notNull(),
    code: text('code').notNull(),
    name: text('name'),
    unitKind: text('unit_kind').notNull(),
    pieceCount: integer('piece_count'),
    periodLabel: text('period_label'),
    periodFromYear: integer('period_from_year'),
    periodToYear: integer('period_to_year'),
    periodStatus: text('period_status'),
    locationId: uuid('location_id').references(() => locations.id),
    locationDetail: text('location_detail').notNull().default(''),
    description: text('description').notNull().default(''),
    collectorJudgment: text('collector_judgment'),
    recordRevision: integer('record_revision').notNull().default(1),
    analysisInputVersion: integer('analysis_input_version')
      .notNull()
      .default(1),
    evidenceVersion: integer('evidence_version').notNull().default(1),
    latestRunId: uuid('latest_run_id'),
    createdAt: instant('created_at').defaultNow().notNull(),
    updatedAt: instant('updated_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('records_owner_code_uq').on(table.ownerId, table.code),
    index('records_owner_updated_idx').on(
      table.ownerId,
      table.updatedAt,
      table.id,
    ),
    index('records_owner_name_idx').on(table.ownerId, table.name, table.id),
    check('records_unit_kind_ck', sql`${table.unitKind} in ('single', 'set')`),
    check(
      'records_piece_count_ck',
      sql`${table.pieceCount} is null or ${table.pieceCount} > 0`,
    ),
    check(
      'records_period_year_ck',
      sql`${table.periodFromYear} is null or ${table.periodToYear} is null or ${table.periodFromYear} <= ${table.periodToYear}`,
    ),
  ],
);

export const recordComponents = pgTable(
  'record_components',
  {
    id: uuid('id').primaryKey(),
    recordId: uuid('record_id')
      .notNull()
      .references(() => records.id),
    ownerId: text('owner_id').notNull(),
    label: text('label').notNull(),
    ordinal: integer('ordinal').notNull(),
  },
  (table) => [
    uniqueIndex('record_components_record_ordinal_uq').on(
      table.recordId,
      table.ordinal,
    ),
    uniqueIndex('record_components_record_id_uq').on(table.recordId, table.id),
  ],
);

export const recordCategories = pgTable(
  'record_categories',
  {
    recordId: uuid('record_id')
      .notNull()
      .references(() => records.id),
    categoryId: uuid('category_id').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.recordId, table.categoryId] }),
    index('record_categories_category_idx').on(table.categoryId),
  ],
);

export const recordMaterials = pgTable(
  'record_materials',
  {
    recordId: uuid('record_id')
      .notNull()
      .references(() => records.id),
    materialId: uuid('material_id').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.recordId, table.materialId] }),
    index('record_materials_material_idx').on(table.materialId),
  ],
);

export const recordTags = pgTable(
  'record_tags',
  {
    recordId: uuid('record_id')
      .notNull()
      .references(() => records.id),
    tag: text('tag').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.recordId, table.tag] }),
    index('record_tags_tag_idx').on(table.tag),
  ],
);

export const recordMeasurements = pgTable(
  'record_measurements',
  {
    recordId: uuid('record_id')
      .notNull()
      .references(() => records.id),
    kind: text('kind').notNull(),
    componentId: uuid('component_id').references(() => recordComponents.id),
    value: numeric('value', { precision: 18, scale: 6 }).notNull(),
    unit: text('unit').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.recordId, table.kind] }),
    check('record_measurements_value_ck', sql`${table.value} > 0`),
    check(
      'record_measurements_unit_ck',
      sql`(${table.kind} = 'weight' and ${table.unit} in ('g', 'kg')) or (${table.kind} in ('height', 'width', 'depth', 'diameter') and ${table.unit} in ('mm', 'cm', 'm'))`,
    ),
  ],
);

export const recordAcquisitions = pgTable(
  'record_acquisitions',
  {
    recordId: uuid('record_id')
      .primaryKey()
      .references(() => records.id),
    acquiredOn: text('acquired_on'),
    seller: text('seller'),
    method: text('method'),
    amount: numeric('amount', { precision: 18, scale: 2 }),
    currency: text('currency'),
    provenanceNote: text('provenance_note'),
  },
  (table) => [
    check(
      'record_acquisitions_amount_currency_ck',
      sql`(${table.amount} is null) = (${table.currency} is null)`,
    ),
  ],
);

export const recordReceipts = pgTable(
  'record_receipts',
  {
    recordId: uuid('record_id')
      .notNull()
      .references(() => records.id),
    assetId: uuid('asset_id').notNull(),
  },
  (table) => [primaryKey({ columns: [table.recordId, table.assetId] })],
);
