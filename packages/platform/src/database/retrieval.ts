import { Prisma } from './generated/client.js';
import { projectedParseRunId } from './source-projection.js';

import type { TransactionPort } from '@antica/application/ports';
import type { ImageMatch, KnowledgeSummary } from '@antica/contracts';
import type { KnowledgeEntry, Region, SourceCitation } from '@antica/domain';

import type { ImageSearchEntry, SearchImage } from '../search/image.js';
import type { TextSearchEntry } from '../search/text.js';
import type { MediaStore } from '../storage/media-store.js';

import type { Database } from './connection.js';
import type {
  evidenceAnchors,
  canonicalViews,
  mediaDerivatives,
  mediaAssets,
  records,
  referenceImages,
  sources,
  sourceRegions,
  sourceVersions,
  sourcePages,
  citations,
  knowledgeEntries,
  knowledgeRevisions,
} from './generated/client.js';

type CollectionImageRow = {
  viewId: canonicalViews['id'];
  assetId: mediaAssets['id'];
  recordId: records['id'];
  key: mediaDerivatives['objectKey'];
};

type ReferenceImageRow = {
  id: referenceImages['id'];
  sourceVersionId: referenceImages['sourceVersionId'];
  derivativeId: referenceImages['storedDerivativeId'];
  locatorId: referenceImages['locatorId'];
  sourceId: sources['id'];
  sourceTitle: sources['title'];
  originalAssetId: mediaDerivatives['originalAssetId'];
  key: mediaDerivatives['objectKey'];
  viewId: canonicalViews['id'];
};

type CitedRegionRow = {
  regionId: sourceRegions['id'];
  rawText: string;
  geometry: sourceRegions['geometry'];
  versionId: sourceVersions['id'];
  sourceId: sourceVersions['sourceId'];
  pageId: sourcePages['id'];
  pageIndex: sourcePages['pageIndex'];
  printedPageLabel: sourcePages['printedPageLabel'];
  viewId: sourcePages['canonicalViewId'];
  citationId: citations['id'];
  relation: citations['relation'];
  availability: citations['availability'];
  verification: citations['verification'];
  entryId: knowledgeEntries['id'];
  displayCode: knowledgeEntries['displayCode'];
  revision: knowledgeEntries['currentRevision'];
  status: knowledgeRevisions['status'];
  title: knowledgeRevisions['titleZhHant'];
  summary: knowledgeRevisions['summaryZhHant'];
  content: KnowledgeEntry['content'];
};

type KnowledgeTextRow = {
  id: knowledgeEntries['id'];
  displayCode: knowledgeEntries['displayCode'];
  revision: knowledgeEntries['currentRevision'];
  status: knowledgeRevisions['status'];
  title: knowledgeRevisions['titleZhHant'];
  summary: knowledgeRevisions['summaryZhHant'];
  content: KnowledgeEntry['content'];
};

/** owner-scoped persistence and media capabilities for retrieval */
export interface RetrievalReaderParams {
  readonly db: Database;
  readonly transaction: TransactionPort;
  readonly storage: MediaStore;
  readonly ownerId: string;
}

/** owner-scoped readers for canonical images and cited text */
export interface RetrievalReaders {
  readQuery(this: void, anchorId: string): Promise<SearchImage>;
  readImageEntries(this: void): Promise<readonly ImageSearchEntry[]>;
  readTextEntries(this: void): Promise<readonly TextSearchEntry[]>;
}

/**
 * reads authorized canonical pixels and cited text from persisted collector data
 * @param root0
 * @param root0.db
 * @param root0.storage
 * @param root0.ownerId
 */
export function createRetrievalReaders({
  db,
  storage,
  ownerId,
}: RetrievalReaderParams): RetrievalReaders {
  async function readQuery(anchorId: string): Promise<SearchImage> {
    const [row] = await db.$queryRaw<
      Array<{
        originalAssetId: evidenceAnchors['originalAssetId'];
        canonicalViewId: canonicalViews['id'];
        key: mediaDerivatives['objectKey'];
        region: evidenceAnchors['region'];
        scopeKind: evidenceAnchors['scopeKind'];
      }>
    >(Prisma.sql`
      select evidence_anchors.original_asset_id as "originalAssetId",
      canonical_views.id as "canonicalViewId",
      media_derivatives.object_key as "key",
      evidence_anchors.region as "region",
      evidence_anchors.scope_kind as "scopeKind"
      from evidence_anchors
      join media_assets on (evidence_anchors.original_asset_id = media_assets.id and media_assets.owner_id = ${ownerId})
      join canonical_views on (evidence_anchors.canonical_view_id = canonical_views.id and canonical_views.original_asset_id = media_assets.id)
      join media_derivatives on (canonical_views.derivative_id = media_derivatives.id and media_derivatives.owner_id = ${ownerId})
      where (evidence_anchors.id = ${anchorId}::uuid and evidence_anchors.owner_id = ${ownerId})
    `);
    if (!row) {
      throw new Error('Query evidence is inaccessible');
    }

    return {
      originalAssetId: row.originalAssetId,
      canonicalViewId: row.canonicalViewId,
      bytes: (await storage.read(row.key)).bytes,
      region: row.scopeKind === 'region' ? (row.region as Region) : null,
    };
  }

  async function readImageEntries(): Promise<readonly ImageSearchEntry[]> {
    const entries: ImageSearchEntry[] = [];
    let viewCursor: string | null = null;
    for (;;) {
      const rows: CollectionImageRow[] = await db.$queryRaw<
        CollectionImageRow[]
      >(Prisma.sql`
        select canonical_views.id as "viewId",
        media_assets.id as "assetId",
        records.id as "recordId",
        media_derivatives.object_key as "key"
        from canonical_views
        join media_assets on (canonical_views.original_asset_id = media_assets.id and media_assets.owner_id = ${ownerId} and media_assets.state = ${'ready'} and media_assets.purpose = ${'object'})
        join media_derivatives on (canonical_views.derivative_id = media_derivatives.id and media_derivatives.owner_id = ${ownerId})
        join records on (media_assets.record_id = records.id and records.owner_id = ${ownerId})
        where ${viewCursor ? Prisma.sql`canonical_views.id > ${viewCursor}::uuid` : Prisma.sql`true`}
        order by canonical_views.id asc
        limit ${200}
      `);
      for (const row of rows) {
        const [categories, materials] = await Promise.all([
          db.recordCategories
            .findMany({
              where: { recordId: row.recordId },
              select: { categoryId: true },
            })
            .then((rows) => rows.map((row) => ({ id: row.categoryId }))),
          db.recordMaterials
            .findMany({
              where: { recordId: row.recordId },
              select: { materialId: true },
            })
            .then((rows) => rows.map((row) => ({ id: row.materialId }))),
        ]);
        const match: Omit<ImageMatch, 'rank'> = {
          ref: {
            kind: 'collection',
            recordId: row.recordId,
            originalAssetId: row.assetId,
          },
          matchingRegions: [
            { canonicalViewId: row.viewId, region: null, derivativeId: null },
          ],
          thumbnail: null,
          sourceLocator: null,
          sourceTitle: null,
          contributorNames: [],
          warningsZhHant: [],
        };
        entries.push({
          image: {
            originalAssetId: row.assetId,
            canonicalViewId: row.viewId,
            bytes: (await storage.read(row.key)).bytes,
            region: null,
          },
          match,
          filterIds: {
            objectTypeIds: categories.map((item) => item.id),
            materialIds: materials.map((item) => item.id),
            periodIds: [],
            regionIds: [],
            sourceIds: [],
          },
        });
      }
      if (rows.length < 200) {
        break;
      }
      viewCursor = rows.at(-1)!.viewId;
    }

    let referenceCursor: string | null = null;
    for (;;) {
      const rows: ReferenceImageRow[] = await db.$queryRaw<
        ReferenceImageRow[]
      >(Prisma.sql`
        select reference_images.id as "id",
        reference_images.source_version_id as "sourceVersionId",
        reference_images.stored_derivative_id as "derivativeId",
        reference_images.locator_id as "locatorId",
        sources.id as "sourceId",
        sources.title as "sourceTitle",
        media_derivatives.original_asset_id as "originalAssetId",
        media_derivatives.object_key as "key",
        canonical_views.id as "viewId"
        from reference_images
        join source_versions on (reference_images.source_version_id = source_versions.id and source_versions.owner_id = ${ownerId})
        join sources on (source_versions.source_id = sources.id and sources.owner_id = ${ownerId})
        join media_derivatives on (reference_images.stored_derivative_id = media_derivatives.id and media_derivatives.owner_id = ${ownerId})
        join canonical_views on media_derivatives.id = canonical_views.derivative_id
        where (reference_images.stored_derivative_id is not null and ${referenceCursor ? Prisma.sql`reference_images.id > ${referenceCursor}::uuid` : Prisma.sql`true`})
        order by reference_images.id asc
        limit ${200}
      `);
      for (const row of rows) {
        const [locator] = await db.sourceLocators.findMany({
          where: {
            AND: [
              { id: row.locatorId },
              { sourceVersionId: row.sourceVersionId },
            ],
          },
        });
        const [page] = locator?.pageId
          ? await db.sourcePages.findMany({ where: { id: locator.pageId } })
          : [];
        const [region] = locator?.regionId
          ? await db.sourceRegions.findMany({ where: { id: locator.regionId } })
          : [];
        const contributors = await db.sourceContributors
          .findMany({
            where: { sourceId: row.sourceId },
            orderBy: [{ ordinal: 'asc' }],
            select: { nameAsPrinted: true },
          })
          .then((rows) => rows.map((row) => ({ name: row.nameAsPrinted })));
        const sourceLocator: ImageMatch['sourceLocator'] =
          locator?.kind === 'page' && page
            ? {
                kind: 'page',
                sourceId: row.sourceId,
                sourceVersionId: row.sourceVersionId,
                pageId: page.id,
                pageIndex: page.pageIndex,
                printedPageLabel: page.printedPageLabel,
                canonicalViewId: locator.canonicalViewId!,
                regionId: locator.regionId,
                region: (region?.geometry as Region | null) ?? null,
                textRange:
                  locator.blockId &&
                  locator.rangeStart !== null &&
                  locator.rangeEnd !== null
                    ? {
                        blockId: locator.blockId,
                        start: locator.rangeStart,
                        end: locator.rangeEnd,
                      }
                    : null,
              }
            : null;
        const match: Omit<ImageMatch, 'rank'> = {
          ref: {
            kind: 'reference',
            sourceVersionId: row.sourceVersionId,
            referenceImageId: row.id,
          },
          matchingRegions: [
            {
              canonicalViewId: row.viewId,
              region:
                sourceLocator?.kind === 'page' ? sourceLocator.region : null,
              derivativeId: row.derivativeId,
            },
          ],
          thumbnail: null,
          sourceLocator,
          sourceTitle: row.sourceTitle,
          contributorNames: contributors.map((item) => item.name),
          warningsZhHant: [],
        };
        entries.push({
          image: {
            originalAssetId: row.originalAssetId,
            canonicalViewId: row.viewId,
            bytes: (await storage.read(row.key)).bytes,
            region:
              sourceLocator?.kind === 'page' ? sourceLocator.region : null,
          },
          match,
          filterIds: {
            objectTypeIds: [],
            materialIds: [],
            periodIds: [],
            regionIds: [],
            sourceIds: [row.sourceId],
          },
        });
      }
      if (rows.length < 200) {
        break;
      }
      referenceCursor = rows.at(-1)!.id;
    }

    return entries;
  }

  async function readTextEntries(): Promise<readonly TextSearchEntry[]> {
    const entries: TextSearchEntry[] = [];
    let regionCursor: {
      readonly regionId: string;
      readonly entryId: string;
    } | null = null;
    for (;;) {
      const rows: CitedRegionRow[] = await db.$queryRaw<
        CitedRegionRow[]
      >(Prisma.sql`
        select source_regions.id as "regionId",
        source_regions.raw_text as "rawText",
        source_regions.geometry as "geometry",
        source_versions.id as "versionId",
        source_versions.source_id as "sourceId",
        source_pages.id as "pageId",
        source_pages.page_index as "pageIndex",
        source_pages.printed_page_label as "printedPageLabel",
        source_pages.canonical_view_id as "viewId",
        citations.id as "citationId",
        citations.relation as "relation",
        citations.availability as "availability",
        citations.verification as "verification",
        knowledge_entries.id as "entryId",
        knowledge_entries.display_code as "displayCode",
        knowledge_entries.current_revision as "revision",
        knowledge_revisions.status as "status",
        knowledge_revisions.title_zh_hant as "title",
        knowledge_revisions.summary_zh_hant as "summary",
        knowledge_revisions.content as "content"
        from source_regions
        join source_pages on source_regions.page_id = source_pages.id
        join source_versions on (source_regions.source_version_id = source_versions.id and source_versions.owner_id = ${ownerId} and source_regions.parse_run_id = ${projectedParseRunId()}::uuid)
        join source_locators on (source_locators.region_id = source_regions.id and source_locators.source_version_id = source_versions.id)
        join citations on citations.locator_id = source_locators.id
        join source_knowledge_drafts on (source_knowledge_drafts.source_version_id = source_versions.id and source_knowledge_drafts.owner_id = ${ownerId})
        join knowledge_entries on (source_knowledge_drafts.entry_id = knowledge_entries.id and knowledge_entries.owner_id = ${ownerId})
        join knowledge_revisions on (knowledge_revisions.entry_id = knowledge_entries.id and knowledge_revisions.revision = knowledge_entries.current_revision)
        where (knowledge_revisions.content_schema_version = 1 and source_pages.source_version_id = source_versions.id and length(trim(source_regions.raw_text)) > 0 and ${regionCursor ? Prisma.sql`(source_regions.id, knowledge_entries.id) > (${regionCursor.regionId}::uuid, ${regionCursor.entryId}::uuid)` : Prisma.sql`true`})
        order by source_regions.id asc, knowledge_entries.id asc
        limit ${200}
      `);
      for (const row of rows) {
        const content = row.content;
        const summary: KnowledgeSummary = {
          id: row.entryId,
          displayCode: row.displayCode,
          revision: row.revision,
          titleZhHant: row.title,
          kinds: [...content.kinds],
          status: row.status as KnowledgeSummary['status'],
          summaryZhHant: row.summary,
          citationCount: content.citations.length,
        };
        const citation: SourceCitation = {
          id: row.citationId,
          locator: {
            kind: 'page',
            sourceId: row.sourceId,
            sourceVersionId: row.versionId,
            pageId: row.pageId,
            pageIndex: row.pageIndex,
            printedPageLabel: row.printedPageLabel,
            canonicalViewId: row.viewId,
            regionId: row.regionId,
            region: row.geometry as Region,
            textRange: null,
          },
          relation: row.relation as SourceCitation['relation'],
          availability: row.availability as SourceCitation['availability'],
          verification: row.verification as SourceCitation['verification'],
        };
        entries.push({
          summary,
          citation,
          contentAsRetrieved: row.rawText,
          sourceRegionId: row.regionId,
        });
      }
      if (rows.length < 200) {
        break;
      }
      regionCursor = {
        regionId: rows.at(-1)!.regionId,
        entryId: rows.at(-1)!.entryId,
      };
    }
    let cursor: string | null = null;
    for (;;) {
      const rows: KnowledgeTextRow[] = await db.$queryRaw<
        KnowledgeTextRow[]
      >(Prisma.sql`
        select knowledge_entries.id as "id",
        knowledge_entries.display_code as "displayCode",
        knowledge_entries.current_revision as "revision",
        knowledge_revisions.status as "status",
        knowledge_revisions.title_zh_hant as "title",
        knowledge_revisions.summary_zh_hant as "summary",
        knowledge_revisions.content as "content"
        from knowledge_entries
        join knowledge_revisions on (knowledge_entries.id = knowledge_revisions.entry_id and knowledge_entries.current_revision = knowledge_revisions.revision)
        where (knowledge_revisions.content_schema_version = 1 and knowledge_entries.owner_id = ${ownerId} and ${cursor ? Prisma.sql`knowledge_entries.id > ${cursor}::uuid` : Prisma.sql`true`})
        order by knowledge_entries.id asc
        limit ${200}
      `);
      for (const row of rows) {
        const content = row.content;
        const summary: KnowledgeSummary = {
          id: row.id,
          displayCode: row.displayCode,
          revision: row.revision,
          titleZhHant: row.title,
          kinds: [...content.kinds],
          status: row.status as KnowledgeSummary['status'],
          summaryZhHant: row.summary,
          citationCount: content.citations.length,
        };
        for (const citation of content.citations) {
          if (
            citation.locator.kind !== 'web' ||
            !citation.locator.excerptAsRetrieved
          ) {
            continue;
          }
          const [version] = await db.sourceVersions
            .findMany({
              where: {
                AND: [{ id: citation.locator.sourceVersionId }, { ownerId }],
              },
              select: { sourceId: true, activeParseRunId: true },
            })
            .then((rows) =>
              rows.map((row) => ({
                sourceId: row.sourceId,
                parseRunId: row.activeParseRunId,
              })),
            );
          if (!version || version.sourceId !== citation.locator.sourceId) {
            continue;
          }
          entries.push({
            summary,
            citation,
            contentAsRetrieved: citation.locator.excerptAsRetrieved,
            sourceRegionId: null,
          });
        }
      }
      if (rows.length < 200) {
        break;
      }
      cursor = rows.at(-1)!.id;
    }

    return entries;
  }

  return { readQuery, readImageEntries, readTextEntries };
}
