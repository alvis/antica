import { and, asc, eq, gt, isNotNull, or, sql } from 'drizzle-orm';
import type { TransactionPort } from '@antica/application/ports';
import type { ImageMatch, KnowledgeSummary } from '@antica/contracts';
import type { KnowledgeEntry, Region, SourceCitation } from '@antica/domain';
import type { ImageSearchEntry, SearchImage } from '../search/image.js';
import type { TextSearchEntry } from '../search/text.js';
import type { MediaStore } from '../storage/media-store.js';
import type { Database } from './connection.js';
import { projectedParseRunId } from './source-projection.js';
import {
  canonicalViews,
  citations,
  evidenceAnchors,
  knowledgeEntries,
  knowledgeRevisions,
  mediaAssets,
  mediaDerivatives,
  recordCategories,
  recordMaterials,
  records,
  referenceImages,
  sourceContributors,
  sourceKnowledgeDrafts,
  sourceLocators,
  sourcePages,
  sourceRegions,
  sources,
  sourceVersions,
} from './schema/index.js';

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
 */
export function createRetrievalReaders({
  db,
  storage,
  ownerId,
}: RetrievalReaderParams): RetrievalReaders {
  async function readQuery(anchorId: string): Promise<SearchImage> {
    const [row] = await db
      .select({
        originalAssetId: evidenceAnchors.originalAssetId,
        canonicalViewId: canonicalViews.id,
        key: mediaDerivatives.objectKey,
        region: evidenceAnchors.region,
        scopeKind: evidenceAnchors.scopeKind,
      })
      .from(evidenceAnchors)
      .innerJoin(
        mediaAssets,
        and(
          eq(evidenceAnchors.originalAssetId, mediaAssets.id),
          eq(mediaAssets.ownerId, ownerId),
        ),
      )
      .innerJoin(
        canonicalViews,
        and(
          eq(evidenceAnchors.canonicalViewId, canonicalViews.id),
          eq(canonicalViews.originalAssetId, mediaAssets.id),
        ),
      )
      .innerJoin(
        mediaDerivatives,
        and(
          eq(canonicalViews.derivativeId, mediaDerivatives.id),
          eq(mediaDerivatives.ownerId, ownerId),
        ),
      )
      .where(
        and(
          eq(evidenceAnchors.id, anchorId),
          eq(evidenceAnchors.ownerId, ownerId),
        ),
      );
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
      const rows = await db
        .select({
          viewId: canonicalViews.id,
          assetId: mediaAssets.id,
          recordId: records.id,
          key: mediaDerivatives.objectKey,
        })
        .from(canonicalViews)
        .innerJoin(
          mediaAssets,
          and(
            eq(canonicalViews.originalAssetId, mediaAssets.id),
            eq(mediaAssets.ownerId, ownerId),
            eq(mediaAssets.state, 'ready'),
            eq(mediaAssets.purpose, 'object'),
          ),
        )
        .innerJoin(
          mediaDerivatives,
          and(
            eq(canonicalViews.derivativeId, mediaDerivatives.id),
            eq(mediaDerivatives.ownerId, ownerId),
          ),
        )
        .innerJoin(
          records,
          and(
            eq(mediaAssets.recordId, records.id),
            eq(records.ownerId, ownerId),
          ),
        )
        .where(viewCursor ? gt(canonicalViews.id, viewCursor) : undefined)
        .orderBy(asc(canonicalViews.id))
        .limit(200);
      for (const row of rows) {
        const [categories, materials] = await Promise.all([
          db
            .select({ id: recordCategories.categoryId })
            .from(recordCategories)
            .where(eq(recordCategories.recordId, row.recordId)),
          db
            .select({ id: recordMaterials.materialId })
            .from(recordMaterials)
            .where(eq(recordMaterials.recordId, row.recordId)),
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
      const rows = await db
        .select({
          id: referenceImages.id,
          sourceVersionId: referenceImages.sourceVersionId,
          derivativeId: referenceImages.storedDerivativeId,
          locatorId: referenceImages.locatorId,
          sourceId: sources.id,
          sourceTitle: sources.title,
          originalAssetId: mediaDerivatives.originalAssetId,
          key: mediaDerivatives.objectKey,
          viewId: canonicalViews.id,
        })
        .from(referenceImages)
        .innerJoin(
          sourceVersions,
          and(
            eq(referenceImages.sourceVersionId, sourceVersions.id),
            eq(sourceVersions.ownerId, ownerId),
          ),
        )
        .innerJoin(
          sources,
          and(
            eq(sourceVersions.sourceId, sources.id),
            eq(sources.ownerId, ownerId),
          ),
        )
        .innerJoin(
          mediaDerivatives,
          and(
            eq(referenceImages.storedDerivativeId, mediaDerivatives.id),
            eq(mediaDerivatives.ownerId, ownerId),
          ),
        )
        .innerJoin(
          canonicalViews,
          eq(mediaDerivatives.id, canonicalViews.derivativeId),
        )
        .where(
          and(
            isNotNull(referenceImages.storedDerivativeId),
            referenceCursor
              ? gt(referenceImages.id, referenceCursor)
              : undefined,
          ),
        )
        .orderBy(asc(referenceImages.id))
        .limit(200);
      for (const row of rows) {
        const [locator] = await db
          .select()
          .from(sourceLocators)
          .where(
            and(
              eq(sourceLocators.id, row.locatorId),
              eq(sourceLocators.sourceVersionId, row.sourceVersionId),
            ),
          );
        const [page] = locator?.pageId
          ? await db
              .select()
              .from(sourcePages)
              .where(eq(sourcePages.id, locator.pageId))
          : [];
        const [region] = locator?.regionId
          ? await db
              .select()
              .from(sourceRegions)
              .where(eq(sourceRegions.id, locator.regionId))
          : [];
        const contributors = await db
          .select({ name: sourceContributors.nameAsPrinted })
          .from(sourceContributors)
          .where(eq(sourceContributors.sourceId, row.sourceId))
          .orderBy(asc(sourceContributors.ordinal));
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
      const rows = await db
        .select({
          regionId: sourceRegions.id,
          rawText: sql<string>`${sourceRegions.rawText}`,
          geometry: sourceRegions.geometry,
          versionId: sourceVersions.id,
          sourceId: sourceVersions.sourceId,
          pageId: sourcePages.id,
          pageIndex: sourcePages.pageIndex,
          printedPageLabel: sourcePages.printedPageLabel,
          viewId: sourcePages.canonicalViewId,
          citationId: citations.id,
          relation: citations.relation,
          availability: citations.availability,
          verification: citations.verification,
          entryId: knowledgeEntries.id,
          displayCode: knowledgeEntries.displayCode,
          revision: knowledgeEntries.currentRevision,
          status: knowledgeRevisions.status,
          title: knowledgeRevisions.titleZhHant,
          summary: knowledgeRevisions.summaryZhHant,
          content: knowledgeRevisions.content,
        })
        .from(sourceRegions)
        .innerJoin(sourcePages, eq(sourceRegions.pageId, sourcePages.id))
        .innerJoin(
          sourceVersions,
          and(
            eq(sourceRegions.sourceVersionId, sourceVersions.id),
            eq(sourceVersions.ownerId, ownerId),
            eq(sourceRegions.parseRunId, projectedParseRunId()),
          ),
        )
        .innerJoin(
          sourceLocators,
          and(
            eq(sourceLocators.regionId, sourceRegions.id),
            eq(sourceLocators.sourceVersionId, sourceVersions.id),
          ),
        )
        .innerJoin(citations, eq(citations.locatorId, sourceLocators.id))
        .innerJoin(
          sourceKnowledgeDrafts,
          and(
            eq(sourceKnowledgeDrafts.sourceVersionId, sourceVersions.id),
            eq(sourceKnowledgeDrafts.ownerId, ownerId),
          ),
        )
        .innerJoin(
          knowledgeEntries,
          and(
            eq(sourceKnowledgeDrafts.entryId, knowledgeEntries.id),
            eq(knowledgeEntries.ownerId, ownerId),
          ),
        )
        .innerJoin(
          knowledgeRevisions,
          and(
            eq(knowledgeRevisions.entryId, knowledgeEntries.id),
            eq(knowledgeRevisions.revision, knowledgeEntries.currentRevision),
          ),
        )
        .where(
          and(
            eq(sourcePages.sourceVersionId, sourceVersions.id),
            sql`length(trim(${sourceRegions.rawText})) > 0`,
            regionCursor
              ? or(
                  gt(sourceRegions.id, regionCursor.regionId),
                  and(
                    eq(sourceRegions.id, regionCursor.regionId),
                    gt(knowledgeEntries.id, regionCursor.entryId),
                  ),
                )
              : undefined,
          ),
        )
        .orderBy(asc(sourceRegions.id), asc(knowledgeEntries.id))
        .limit(200);
      for (const row of rows) {
        const content = row.content as KnowledgeEntry['content'];
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
      const rows = await db
        .select({
          id: knowledgeEntries.id,
          displayCode: knowledgeEntries.displayCode,
          revision: knowledgeEntries.currentRevision,
          status: knowledgeRevisions.status,
          title: knowledgeRevisions.titleZhHant,
          summary: knowledgeRevisions.summaryZhHant,
          content: knowledgeRevisions.content,
        })
        .from(knowledgeEntries)
        .innerJoin(
          knowledgeRevisions,
          and(
            eq(knowledgeEntries.id, knowledgeRevisions.entryId),
            eq(knowledgeEntries.currentRevision, knowledgeRevisions.revision),
          ),
        )
        .where(
          and(
            eq(knowledgeEntries.ownerId, ownerId),
            cursor ? gt(knowledgeEntries.id, cursor) : undefined,
          ),
        )
        .orderBy(asc(knowledgeEntries.id))
        .limit(200);
      for (const row of rows) {
        const content = row.content as KnowledgeEntry['content'];
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
          const [version] = await db
            .select({
              sourceId: sourceVersions.sourceId,
              parseRunId: sourceVersions.activeParseRunId,
            })
            .from(sourceVersions)
            .where(
              and(
                eq(sourceVersions.id, citation.locator.sourceVersionId),
                eq(sourceVersions.ownerId, ownerId),
              ),
            );
          if (!version || version.sourceId !== citation.locator.sourceId) {
            continue;
          }
          entries.push({
            summary,
            citation: citation,
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
