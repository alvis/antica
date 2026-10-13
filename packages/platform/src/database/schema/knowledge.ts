import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { canonicalViews, mediaAssets, mediaDerivatives } from './media.js';
import { records } from './records.js';
import { jobs } from './runtime.js';

const instant = (name: string) =>
  timestamp(name, { withTimezone: true, mode: 'string' });

export const sources = pgTable(
  'sources',
  {
    id: uuid('id').primaryKey(),
    ownerId: text('owner_id').notNull(),
    kind: text('kind').notNull(),
    revision: integer('revision').notNull().default(1),
    currentVersionId: uuid('current_version_id'),
    title: text('title').notNull(),
    authorStatus: text('author_status').notNull(),
    editionStatement: text('edition_statement'),
    publisher: text('publisher'),
    publicationDateAsPrinted: text('publication_date_as_printed'),
    isbn: text('isbn'),
    canonicalUrl: text('canonical_url'),
    access: text('access').notNull(),
    rightsStatement: text('rights_statement'),
    attributionText: text('attribution_text'),
    createdAt: instant('created_at').defaultNow().notNull(),
    updatedAt: instant('updated_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('sources_owner_id_uq').on(table.ownerId, table.id),
    index('sources_owner_title_idx').on(table.ownerId, table.title, table.id),
  ],
);

export const sourceContributors = pgTable(
  'source_contributors',
  {
    sourceId: uuid('source_id')
      .notNull()
      .references(() => sources.id),
    ordinal: integer('ordinal').notNull(),
    nameAsPrinted: text('name_as_printed').notNull(),
    role: text('role').notNull(),
    attribution: text('attribution').notNull(),
  },
  (table) => [primaryKey({ columns: [table.sourceId, table.ordinal] })],
);

export const sourceLanguages = pgTable(
  'source_languages',
  {
    sourceId: uuid('source_id')
      .notNull()
      .references(() => sources.id),
    language: text('language').notNull(),
  },
  (table) => [primaryKey({ columns: [table.sourceId, table.language] })],
);

export const sourceVersions = pgTable(
  'source_versions',
  {
    id: uuid('id').primaryKey(),
    sourceId: uuid('source_id')
      .notNull()
      .references(() => sources.id),
    ownerId: text('owner_id').notNull(),
    sourceHash: text('source_hash').notNull(),
    metadataSnapshot: jsonb('metadata_snapshot').notNull(),
    capturedAt: instant('captured_at').notNull(),
    retrievedAt: instant('retrieved_at'),
    status: text('status').notNull(),
    textIndexStatus: text('text_index_status').notNull(),
    imageIndexStatus: text('image_index_status').notNull(),
    activeParseRunId: uuid('active_parse_run_id'),
  },
  (table) => [
    uniqueIndex('source_versions_owner_hash_uq').on(
      table.ownerId,
      table.sourceHash,
    ),
    unique('source_versions_owner_id_uq').on(table.ownerId, table.id),
    uniqueIndex('source_versions_source_id_uq').on(table.sourceId, table.id),
  ],
);

export const sourceArtifacts = pgTable(
  'source_artifacts',
  {
    assetId: uuid('asset_id')
      .primaryKey()
      .references(() => mediaAssets.id),
    ownerId: text('owner_id').notNull(),
    sourceVersionId: uuid('source_version_id').notNull(),
    parseRunId: uuid('parse_run_id').notNull(),
    kind: text('kind').notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.ownerId, table.sourceVersionId],
      foreignColumns: [sourceVersions.ownerId, sourceVersions.id],
    }),
    index('source_artifacts_parse_run_idx').on(table.parseRunId, table.kind),
  ],
);

export const sourceVersionAssets = pgTable(
  'source_version_assets',
  {
    versionId: uuid('version_id')
      .notNull()
      .references(() => sourceVersions.id),
    assetId: uuid('asset_id')
      .notNull()
      .references(() => mediaAssets.id),
    ordinal: integer('ordinal').notNull(),
    printedLabel: text('printed_label'),
    presentation: jsonb('presentation'),
  },
  (table) => [
    primaryKey({ columns: [table.versionId, table.assetId] }),
    uniqueIndex('source_version_assets_ordinal_uq').on(
      table.versionId,
      table.ordinal,
    ),
    uniqueIndex('source_version_assets_asset_uq').on(table.assetId),
  ],
);

export const sourcePages = pgTable(
  'source_pages',
  {
    id: uuid('id').primaryKey(),
    sourceVersionId: uuid('source_version_id')
      .notNull()
      .references(() => sourceVersions.id),
    pageIndex: integer('page_index').notNull(),
    printedPageLabel: text('printed_page_label'),
    originalAssetId: uuid('original_asset_id')
      .notNull()
      .references(() => mediaAssets.id),
    pdfPageIndex: integer('pdf_page_index'),
    canonicalViewId: uuid('canonical_view_id')
      .notNull()
      .references(() => canonicalViews.id),
  },
  (table) => [
    uniqueIndex('source_pages_version_index_uq').on(
      table.sourceVersionId,
      table.pageIndex,
    ),
    uniqueIndex('source_pages_version_id_uq').on(
      table.sourceVersionId,
      table.id,
    ),
    check(
      'source_pages_index_ck',
      sql`${table.pageIndex} >= 0 and (${table.pdfPageIndex} is null or ${table.pdfPageIndex} >= 0)`,
    ),
  ],
);

export const parseRuns = pgTable('parse_runs', {
  id: uuid('id').primaryKey(),
  sourceVersionId: uuid('source_version_id')
    .notNull()
    .references(() => sourceVersions.id),
  jobId: uuid('job_id')
    .notNull()
    .references(() => jobs.id),
  provider: text('provider').notNull(),
  rawOutputAssetId: uuid('raw_output_asset_id').references(
    () => mediaAssets.id,
  ),
  status: text('status').notNull(),
  createdAt: instant('created_at').defaultNow().notNull(),
});

export const sourcePageParses = pgTable(
  'source_page_parses',
  {
    parseRunId: uuid('parse_run_id')
      .notNull()
      .references(() => parseRuns.id),
    pageId: uuid('page_id')
      .notNull()
      .references(() => sourcePages.id),
    rawText: text('raw_text').notNull(),
    searchText: text('search_text').notNull(),
    quality: text('quality').notNull(),
  },
  (table) => [primaryKey({ columns: [table.parseRunId, table.pageId] })],
);

export const sourceBlocks = pgTable(
  'source_blocks',
  {
    id: uuid('id').primaryKey(),
    parseRunId: uuid('parse_run_id')
      .notNull()
      .references(() => parseRuns.id),
    pageId: uuid('page_id')
      .notNull()
      .references(() => sourcePages.id),
    rawText: text('raw_text').notNull(),
    searchMapping: jsonb('search_mapping').notNull(),
    ordinal: integer('ordinal').notNull(),
  },
  (table) => [
    index('source_blocks_page_idx').on(
      table.parseRunId,
      table.pageId,
      table.ordinal,
    ),
  ],
);

export const sourceRegions = pgTable(
  'source_regions',
  {
    id: uuid('id').primaryKey(),
    sourceVersionId: uuid('source_version_id')
      .notNull()
      .references(() => sourceVersions.id),
    pageId: uuid('page_id')
      .notNull()
      .references(() => sourcePages.id),
    parseRunId: uuid('parse_run_id')
      .notNull()
      .references(() => parseRuns.id),
    kind: text('kind').notNull(),
    geometry: jsonb('geometry').notNull(),
    rawText: text('raw_text'),
  },
  (table) => [index('source_regions_page_idx').on(table.pageId, table.kind)],
);

export const regionRelations = pgTable(
  'region_relations',
  {
    fromId: uuid('from_id')
      .notNull()
      .references(() => sourceRegions.id),
    toId: uuid('to_id')
      .notNull()
      .references(() => sourceRegions.id),
    kind: text('kind').notNull(),
  },
  (table) => [primaryKey({ columns: [table.fromId, table.toId, table.kind] })],
);

export const sourceLocators = pgTable(
  'source_locators',
  {
    id: uuid('id').primaryKey(),
    sourceId: uuid('source_id')
      .notNull()
      .references(() => sources.id),
    sourceVersionId: uuid('source_version_id')
      .notNull()
      .references(() => sourceVersions.id),
    kind: text('kind').notNull(),
    pageId: uuid('page_id').references(() => sourcePages.id),
    pageIndex: integer('page_index'),
    printedPageLabel: text('printed_page_label'),
    canonicalViewId: uuid('canonical_view_id').references(
      () => canonicalViews.id,
    ),
    regionId: uuid('region_id').references(() => sourceRegions.id),
    geometry: jsonb('geometry'),
    blockId: uuid('block_id').references(() => sourceBlocks.id),
    rangeStart: integer('range_start'),
    rangeEnd: integer('range_end'),
    url: text('url'),
    retrievedAt: instant('retrieved_at'),
    snapshotAssetId: uuid('snapshot_asset_id').references(() => mediaAssets.id),
    excerptAsRetrieved: text('excerpt_as_retrieved'),
  },
  (table) => [
    index('source_locators_version_idx').on(table.sourceVersionId, table.kind),
    check(
      'source_locators_branch_ck',
      sql`(${table.kind} = 'page' and ${table.pageId} is not null and ${table.canonicalViewId} is not null and ${table.url} is null) or (${table.kind} = 'web' and ${table.url} is not null and ${table.retrievedAt} is not null and ${table.pageId} is null)`,
    ),
    check(
      'source_locators_range_ck',
      sql`(${table.rangeStart} is null and ${table.rangeEnd} is null) or (${table.blockId} is not null and ${table.rangeStart} >= 0 and ${table.rangeEnd} > ${table.rangeStart})`,
    ),
  ],
);

export const citations = pgTable(
  'citations',
  {
    id: uuid('id').primaryKey(),
    locatorId: uuid('locator_id')
      .notNull()
      .references(() => sourceLocators.id),
    relation: text('relation').notNull(),
    availability: text('availability').notNull(),
    verification: text('verification').notNull(),
  },
  (table) => [index('citations_locator_idx').on(table.locatorId)],
);

export const referenceImages = pgTable(
  'reference_images',
  {
    id: uuid('id').primaryKey(),
    sourceVersionId: uuid('source_version_id')
      .notNull()
      .references(() => sourceVersions.id),
    locatorId: uuid('locator_id')
      .notNull()
      .references(() => sourceLocators.id),
    figureRegionId: uuid('figure_region_id').references(() => sourceRegions.id),
    storedDerivativeId: uuid('stored_derivative_id').references(
      () => mediaDerivatives.id,
    ),
    externalImageUrl: text('external_image_url'),
    captionText: text('caption_text'),
    captionLocatorId: uuid('caption_locator_id').references(
      () => sourceLocators.id,
    ),
    generatedDescriptionZhHant: text('generated_description_zh_hant'),
    descriptionJobId: uuid('description_job_id').references(() => jobs.id),
    captionAssociation: text('caption_association').notNull(),
  },
  (table) => [
    index('reference_images_version_idx').on(table.sourceVersionId, table.id),
  ],
);

export const knowledgeEntries = pgTable(
  'knowledge_entries',
  {
    id: uuid('id').primaryKey(),
    ownerId: text('owner_id').notNull(),
    displayCode: text('display_code').notNull(),
    currentRevision: integer('current_revision').notNull(),
    createdAt: instant('created_at').defaultNow().notNull(),
    updatedAt: instant('updated_at').defaultNow().notNull(),
  },
  (table) => [
    unique('knowledge_entries_owner_id_uq').on(table.ownerId, table.id),
    uniqueIndex('knowledge_entries_owner_code_uq').on(
      table.ownerId,
      table.displayCode,
    ),
  ],
);

export const sourceKnowledgeDrafts = pgTable(
  'source_knowledge_drafts',
  {
    ownerId: text('owner_id').notNull(),
    sourceVersionId: uuid('source_version_id').notNull(),
    entryId: uuid('entry_id').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.sourceVersionId, table.entryId] }),
    foreignKey({
      columns: [table.ownerId, table.sourceVersionId],
      foreignColumns: [sourceVersions.ownerId, sourceVersions.id],
    }),
    foreignKey({
      columns: [table.ownerId, table.entryId],
      foreignColumns: [knowledgeEntries.ownerId, knowledgeEntries.id],
    }),
    index('source_knowledge_drafts_entry_idx').on(table.entryId),
  ],
);

export const knowledgeRevisions = pgTable(
  'knowledge_revisions',
  {
    entryId: uuid('entry_id')
      .notNull()
      .references(() => knowledgeEntries.id),
    revision: integer('revision').notNull(),
    status: text('status').notNull(),
    savedBy: text('saved_by'),
    titleZhHant: text('title_zh_hant').notNull(),
    summaryZhHant: text('summary_zh_hant').notNull(),
    content: jsonb('content').notNull(),
    contentHash: text('content_hash').notNull(),
    createdAt: instant('created_at').defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.entryId, table.revision] }),
    index('knowledge_revisions_title_idx').on(table.titleZhHant),
  ],
);

export const knowledgeRevisionAliases = pgTable(
  'knowledge_revision_aliases',
  {
    entryId: uuid('entry_id')
      .notNull()
      .references(() => knowledgeEntries.id),
    revision: integer('revision').notNull(),
    alias: text('alias').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.entryId, table.revision, table.alias] }),
  ],
);

export const knowledgeRevisionKinds = pgTable(
  'knowledge_revision_kinds',
  {
    entryId: uuid('entry_id')
      .notNull()
      .references(() => knowledgeEntries.id),
    revision: integer('revision').notNull(),
    kind: text('kind').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.entryId, table.revision, table.kind] }),
    index('knowledge_revision_kinds_kind_idx').on(table.kind),
  ],
);

export const knowledgeRevisionCitations = pgTable(
  'knowledge_revision_citations',
  {
    entryId: uuid('entry_id')
      .notNull()
      .references(() => knowledgeEntries.id),
    revision: integer('revision').notNull(),
    citationId: uuid('citation_id')
      .notNull()
      .references(() => citations.id),
  },
  (table) => [
    primaryKey({ columns: [table.entryId, table.revision, table.citationId] }),
  ],
);

export const inspectionMethods = pgTable('inspection_methods', {
  id: uuid('id').primaryKey(),
  owningEntryId: uuid('owning_entry_id')
    .notNull()
    .references(() => knowledgeEntries.id),
  currentVersionId: uuid('current_version_id'),
});

export const methodVersions = pgTable(
  'method_versions',
  {
    id: uuid('id').primaryKey(),
    methodId: uuid('method_id')
      .notNull()
      .references(() => inspectionMethods.id),
    revision: integer('revision').notNull(),
    definition: jsonb('definition').notNull(),
    contentHash: text('content_hash').notNull(),
    createdAt: instant('created_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('method_versions_method_revision_uq').on(
      table.methodId,
      table.revision,
    ),
  ],
);

export const knowledgeRevisionMethods = pgTable(
  'knowledge_revision_methods',
  {
    entryId: uuid('entry_id')
      .notNull()
      .references(() => knowledgeEntries.id),
    revision: integer('revision').notNull(),
    methodId: uuid('method_id')
      .notNull()
      .references(() => inspectionMethods.id),
    methodVersionId: uuid('method_version_id')
      .notNull()
      .references(() => methodVersions.id),
  },
  (table) => [
    primaryKey({ columns: [table.entryId, table.revision, table.methodId] }),
  ],
);

export const researchRuns = pgTable('research_runs', {
  id: uuid('id').primaryKey(),
  ownerId: text('owner_id').notNull(),
  jobId: uuid('job_id')
    .notNull()
    .references(() => jobs.id),
  requestKey: uuid('request_key').notNull(),
  recordId: uuid('record_id').references(() => records.id),
  entryId: uuid('entry_id').references(() => knowledgeEntries.id),
  instruction: text('instruction').notNull(),
  scope: text('scope').notNull(),
  preferNamedAuthors: text('prefer_named_authors').notNull(),
  warnings: jsonb('warnings')
    .notNull()
    .default(sql`'[]'::jsonb`),
  createdAt: instant('created_at').defaultNow().notNull(),
});

export const researchSources = pgTable(
  'research_sources',
  {
    researchId: uuid('research_id')
      .notNull()
      .references(() => researchRuns.id),
    sourceVersionId: uuid('source_version_id')
      .notNull()
      .references(() => sourceVersions.id),
  },
  (table) => [
    primaryKey({ columns: [table.researchId, table.sourceVersionId] }),
  ],
);

export const researchDraftRevisions = pgTable(
  'research_draft_revisions',
  {
    researchId: uuid('research_id')
      .notNull()
      .references(() => researchRuns.id),
    revision: integer('revision').notNull(),
    immutableContent: jsonb('immutable_content').notNull(),
    contentHash: text('content_hash').notNull(),
    createdAt: instant('created_at').defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.researchId, table.revision] })],
);

export const notes = pgTable('notes', {
  id: uuid('id').primaryKey(),
  ownerId: text('owner_id').notNull(),
  researchId: uuid('research_id')
    .notNull()
    .references(() => researchRuns.id),
  draftRevision: integer('draft_revision').notNull(),
  title: text('title').notNull(),
  recordId: uuid('record_id').references(() => records.id),
  entryId: uuid('entry_id').references(() => knowledgeEntries.id),
  savedBy: text('saved_by').notNull(),
  savedAt: instant('saved_at').defaultNow().notNull(),
});

export const noteParagraphs = pgTable(
  'note_paragraphs',
  {
    noteId: uuid('note_id')
      .notNull()
      .references(() => notes.id),
    ordinal: integer('ordinal').notNull(),
    text: text('text').notNull(),
    content: jsonb('content'),
  },
  (table) => [primaryKey({ columns: [table.noteId, table.ordinal] })],
);

export const noteCitations = pgTable(
  'note_citations',
  {
    noteId: uuid('note_id')
      .notNull()
      .references(() => notes.id),
    citationId: uuid('citation_id')
      .notNull()
      .references(() => citations.id),
  },
  (table) => [primaryKey({ columns: [table.noteId, table.citationId] })],
);

export const referenceLinks = pgTable(
  'reference_links',
  {
    id: uuid('id').primaryKey(),
    ownerId: text('owner_id').notNull(),
    targetRecordId: uuid('target_record_id')
      .notNull()
      .references(() => records.id),
    targetCheckId: uuid('target_check_id'),
    targetObservationId: uuid('target_observation_id'),
    targetAnchorId: uuid('target_anchor_id'),
    subjectKind: text('subject_kind').notNull(),
    sourceLocatorId: uuid('source_locator_id').references(
      () => sourceLocators.id,
    ),
    referenceImageId: uuid('reference_image_id').references(
      () => referenceImages.id,
    ),
    subjectRecordId: uuid('subject_record_id').references(() => records.id),
    originalAssetId: uuid('original_asset_id').references(() => mediaAssets.id),
    subjectAnchorId: uuid('subject_anchor_id'),
    comparisonId: uuid('comparison_id'),
    note: text('note'),
    targetIdentityKey: text('target_identity_key').notNull(),
    subjectIdentityKey: text('subject_identity_key').notNull(),
    versions: jsonb('versions'),
    createdAt: instant('created_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('reference_links_identity_uq').on(
      table.ownerId,
      table.targetIdentityKey,
      table.subjectIdentityKey,
    ),
    index('reference_links_record_idx').on(
      table.ownerId,
      table.targetRecordId,
      table.createdAt,
      table.id,
    ),
  ],
);

export const indexVersions = pgTable('index_versions', {
  id: uuid('id').primaryKey(),
  kind: text('kind').notNull(),
  embeddingModelId: text('embedding_model_id').notNull(),
  dimensions: integer('dimensions').notNull(),
  status: text('status').notNull(),
  createdAt: instant('created_at').defaultNow().notNull(),
});

export const sourceIndexMemberships = pgTable(
  'source_index_memberships',
  {
    indexId: uuid('index_id')
      .notNull()
      .references(() => indexVersions.id),
    sourceVersionId: uuid('source_version_id')
      .notNull()
      .references(() => sourceVersions.id),
    status: text('status').notNull(),
  },
  (table) => [primaryKey({ columns: [table.indexId, table.sourceVersionId] })],
);

export const sourceChunkMappings = pgTable(
  'source_chunk_mappings',
  {
    id: uuid('id').primaryKey(),
    provider: text('provider').notNull(),
    indexId: uuid('index_id')
      .notNull()
      .references(() => indexVersions.id),
    parseRunId: uuid('parse_run_id')
      .notNull()
      .references(() => parseRuns.id),
    providerChunkId: text('provider_chunk_id').notNull(),
    providerFigureId: text('provider_figure_id'),
    sourceVersionId: uuid('source_version_id')
      .notNull()
      .references(() => sourceVersions.id),
  },
  (table) => [
    uniqueIndex('source_chunk_mappings_provider_uq').on(
      table.provider,
      table.indexId,
      table.providerChunkId,
    ),
  ],
);

export const mappingRegions = pgTable(
  'mapping_regions',
  {
    mappingId: uuid('mapping_id')
      .notNull()
      .references(() => sourceChunkMappings.id),
    regionId: uuid('region_id')
      .notNull()
      .references(() => sourceRegions.id),
  },
  (table) => [primaryKey({ columns: [table.mappingId, table.regionId] })],
);

export const imageIndexItems = pgTable(
  'image_index_items',
  {
    id: uuid('id').primaryKey(),
    indexId: uuid('index_id')
      .notNull()
      .references(() => indexVersions.id),
    referenceImageId: uuid('reference_image_id').references(
      () => referenceImages.id,
    ),
    originalAssetId: uuid('original_asset_id').references(() => mediaAssets.id),
    derivativeId: uuid('derivative_id')
      .notNull()
      .references(() => mediaDerivatives.id),
  },
  (table) => [
    check(
      'image_index_items_target_ck',
      sql`num_nonnulls(${table.referenceImageId}, ${table.originalAssetId}) = 1`,
    ),
  ],
);
