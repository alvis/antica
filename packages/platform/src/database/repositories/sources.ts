import { createHash, randomUUID } from 'node:crypto';

import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';

import { sourceDetailSchema } from '@antica/contracts';

import { indexVersionId } from '../index-version.js';
import {
  canonicalViews,
  citations,
  indexVersions,
  jobs,
  mappingRegions,
  mediaAssets,
  mediaDerivatives,
  parseRuns,
  referenceImages,
  regionRelations,
  sourceArtifacts,
  sourceChunkMappings,
  sourceContributors,
  sourceKnowledgeDrafts,
  sourceLanguages,
  sourceLocators,
  sourcePageParses,
  sourcePages,
  sourceRegions,
  sources,
  sourceVersionAssets,
  sourceVersions,
} from '../schema/index.js';
import { projectedParseRunId } from '../source-projection.js';

import type {
  IndexIdentity,
  ProviderChunkMapping,
  SourceRegistrationAsset,
  SourceRepository,
} from '@antica/application/ports';
import type { SourceDetail } from '@antica/contracts';
import type {
  ReferenceImage,
  Source,
  SourceCitation,
  SourceLocator,
  SourcePage,
  SourceRegion,
  SourceVersion,
} from '@antica/domain';

import type { Transaction } from '../transaction.js';

type PageCursor = { readonly pageIndex: number; readonly id: string };

function encodeCursor(cursor: PageCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

function decodeCursor(value: string): PageCursor {
  const cursor = JSON.parse(
    Buffer.from(value, 'base64url').toString('utf8'),
  ) as PageCursor;
  if (
    !Number.isInteger(cursor.pageIndex) ||
    cursor.pageIndex < 0 ||
    typeof cursor.id !== 'string'
  ) {
    throw new Error('Invalid source page cursor');
  }

  return cursor;
}

function stableUuid(value: string): string {
  const digest = createHash('sha256').update(value).digest('hex');

  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}

function iso(value: string): string {
  return new Date(value).toISOString();
}

function toSource(
  row: typeof sources.$inferSelect,
  contributors: Source['metadata']['contributors'],
  languages: readonly string[],
): Source {
  return {
    id: row.id,
    revision: row.revision,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
    kind: row.kind as Source['kind'],
    currentVersionId: row.currentVersionId!,
    metadata: {
      title: row.title,
      contributors,
      authorStatus: row.authorStatus as Source['metadata']['authorStatus'],
      editionStatement: row.editionStatement,
      publisher: row.publisher,
      publicationDateAsPrinted: row.publicationDateAsPrinted,
      isbn: row.isbn,
      languages,
      canonicalUrl: row.canonicalUrl,
      access: row.access as Source['metadata']['access'],
      rightsStatement: row.rightsStatement,
      attributionText: row.attributionText,
    },
  };
}

async function readVersion(
  tx: Transaction,
  ownerId: string,
  id: string,
): Promise<SourceVersion | null> {
  const [row] = await tx
    .select()
    .from(sourceVersions)
    .where(and(eq(sourceVersions.id, id), eq(sourceVersions.ownerId, ownerId)));
  if (!row) {
    return null;
  }
  const assets = await tx
    .select({ id: sourceVersionAssets.assetId })
    .from(sourceVersionAssets)
    .where(eq(sourceVersionAssets.versionId, id))
    .orderBy(asc(sourceVersionAssets.ordinal));

  return {
    id: row.id,
    sourceId: row.sourceId,
    originalAssetIds: assets.map((asset) => asset.id),
    sourceHash: row.sourceHash,
    metadataSnapshot: row.metadataSnapshot as SourceVersion['metadataSnapshot'],
    capturedAt: iso(row.capturedAt),
    retrievedAt: row.retrievedAt ? iso(row.retrievedAt) : null,
    status: row.status as SourceVersion['status'],
    textIndexStatus: row.textIndexStatus as SourceVersion['textIndexStatus'],
    imageIndexStatus: row.imageIndexStatus as SourceVersion['imageIndexStatus'],
    activeParseRunId: row.activeParseRunId,
  };
}

/**
 * reads a canonical locator only when its source belongs to the owner
 * @param tx transaction used for the locator and source ownership lookup
 * @param ownerId owner required to access the locator's source
 * @param id stable locator identifier
 * @returns the locator, or null when it is missing or inaccessible
 */
export async function readSourceLocator(
  tx: Transaction,
  ownerId: string,
  id: string,
): Promise<SourceLocator | null> {
  const [row] = await tx
    .select()
    .from(sourceLocators)
    .innerJoin(
      sources,
      and(
        eq(sourceLocators.sourceId, sources.id),
        eq(sources.ownerId, ownerId),
      ),
    )
    .where(eq(sourceLocators.id, id));
  if (!row) {
    return null;
  }
  const locator = row.source_locators;
  if (locator.kind === 'web') {
    return {
      kind: 'web',
      sourceId: locator.sourceId,
      sourceVersionId: locator.sourceVersionId,
      url: locator.url!,
      retrievedAt: iso(locator.retrievedAt!),
      snapshotAssetId: locator.snapshotAssetId,
      blockId: locator.blockId,
      excerptAsRetrieved: locator.excerptAsRetrieved,
    };
  }

  return {
    kind: 'page',
    sourceId: locator.sourceId,
    sourceVersionId: locator.sourceVersionId,
    pageId: locator.pageId!,
    pageIndex: locator.pageIndex!,
    printedPageLabel: locator.printedPageLabel,
    canonicalViewId: locator.canonicalViewId!,
    regionId: locator.regionId,
    region: locator.geometry as Extract<
      SourceLocator,
      { kind: 'page' }
    >['region'],
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
  };
}

/**
 * writes a source locator once under its stable identity
 * @param tx transaction used to persist the locator
 * @param locatorId stable identifier retained by citations and reference images
 * @param locator canonical page or web location to persist
 */
export async function writeSourceLocator(
  tx: Transaction,
  locatorId: string,
  locator: SourceLocator,
): Promise<void> {
  await tx
    .insert(sourceLocators)
    .values(
      locator.kind === 'web'
        ? {
            id: locatorId,
            sourceId: locator.sourceId,
            sourceVersionId: locator.sourceVersionId,
            kind: locator.kind,
            url: locator.url,
            retrievedAt: locator.retrievedAt,
            snapshotAssetId: locator.snapshotAssetId,
            blockId: locator.blockId,
            excerptAsRetrieved: locator.excerptAsRetrieved,
          }
        : {
            id: locatorId,
            sourceId: locator.sourceId,
            sourceVersionId: locator.sourceVersionId,
            kind: locator.kind,
            pageId: locator.pageId,
            pageIndex: locator.pageIndex,
            printedPageLabel: locator.printedPageLabel,
            canonicalViewId: locator.canonicalViewId,
            regionId: locator.regionId,
            geometry: locator.region,
            blockId: locator.textRange?.blockId,
            rangeStart: locator.textRange?.start,
            rangeEnd: locator.textRange?.end,
          },
    )
    .onConflictDoNothing();
}

/**
 * reads a citation only when its locator belongs to the owner
 * @param tx transaction used for the citation and locator lookup
 * @param ownerId owner required to access the citation's source
 * @param id citation identifier
 * @returns the citation, or null when it is missing or its locator is inaccessible
 */
export async function readCitation(
  tx: Transaction,
  ownerId: string,
  id: string,
): Promise<SourceCitation | null> {
  const [row] = await tx.select().from(citations).where(eq(citations.id, id));
  if (!row) {
    return null;
  }
  const locator = await readSourceLocator(tx, ownerId, row.locatorId);

  return locator
    ? {
        id: row.id,
        locator,
        relation: row.relation as SourceCitation['relation'],
        availability: row.availability as SourceCitation['availability'],
        verification: row.verification as SourceCitation['verification'],
      }
    : null;
}

/**
 * reads a reference image only when its version and required locator are accessible
 * @param tx transaction used for the image and locator lookups
 * @param ownerId owner required to access the image's source version
 * @param id reference image identifier
 * @returns the image with a caption only if its locator resolves, or null when
 * the image or required locator is inaccessible
 */
export async function readReferenceImage(
  tx: Transaction,
  ownerId: string,
  id: string,
): Promise<ReferenceImage | null> {
  const [row] = await tx
    .select()
    .from(referenceImages)
    .innerJoin(
      sourceVersions,
      and(
        eq(referenceImages.sourceVersionId, sourceVersions.id),
        eq(sourceVersions.ownerId, ownerId),
      ),
    )
    .where(eq(referenceImages.id, id));
  if (!row) {
    return null;
  }
  const locator = await readSourceLocator(
    tx,
    ownerId,
    row.reference_images.locatorId,
  );
  if (!locator) {
    return null;
  }
  const captionLocator = row.reference_images.captionLocatorId
    ? await readSourceLocator(
        tx,
        ownerId,
        row.reference_images.captionLocatorId,
      )
    : null;

  return {
    id: row.reference_images.id,
    sourceVersionId: row.reference_images.sourceVersionId,
    locator,
    figureRegionId: row.reference_images.figureRegionId,
    storedDerivativeId: row.reference_images.storedDerivativeId,
    externalImageUrl: row.reference_images.externalImageUrl,
    originalCaption:
      row.reference_images.captionText && captionLocator
        ? {
            textAsPrinted: row.reference_images.captionText,
            locator: captionLocator,
          }
        : null,
    generatedDescriptionZhHant: row.reference_images.generatedDescriptionZhHant,
    descriptionJobId: row.reference_images.descriptionJobId,
    captionAssociation: row.reference_images
      .captionAssociation as ReferenceImage['captionAssociation'],
  };
}

async function readPage(
  tx: Transaction,
  ownerId: string,
  id: string,
): Promise<SourcePage | null> {
  const [row] = await tx
    .select()
    .from(sourcePages)
    .innerJoin(
      sourceVersions,
      and(
        eq(sourcePages.sourceVersionId, sourceVersions.id),
        eq(sourceVersions.ownerId, ownerId),
      ),
    )
    .innerJoin(
      canonicalViews,
      eq(sourcePages.canonicalViewId, canonicalViews.id),
    )
    .leftJoin(
      sourceVersionAssets,
      and(
        eq(sourceVersionAssets.versionId, sourcePages.sourceVersionId),
        eq(sourceVersionAssets.assetId, sourcePages.originalAssetId),
      ),
    )
    .where(eq(sourcePages.id, id));
  if (!row) {
    return null;
  }
  const page = row.source_pages;
  const [selection] = await tx
    .select({ parseRunId: projectedParseRunId() })
    .from(sourcePages)
    .innerJoin(
      sourceVersions,
      eq(sourcePages.sourceVersionId, sourceVersions.id),
    )
    .where(and(eq(sourcePages.id, id), eq(sourceVersions.ownerId, ownerId)));
  const parseRunId = selection?.parseRunId;
  const [parsed] = parseRunId
    ? await tx
        .select()
        .from(sourcePageParses)
        .where(
          and(
            eq(sourcePageParses.pageId, id),
            eq(sourcePageParses.parseRunId, parseRunId),
          ),
        )
    : [];
  const regions = parseRunId
    ? await tx
        .select({ id: sourceRegions.id })
        .from(sourceRegions)
        .where(
          and(
            eq(sourceRegions.pageId, id),
            eq(sourceRegions.parseRunId, parseRunId),
          ),
        )
    : [];

  return {
    id: page.id,
    sourceVersionId: page.sourceVersionId,
    pageIndex: page.pageIndex,
    printedPageLabel: page.printedPageLabel,
    originalAssetId: page.originalAssetId,
    pdfPageIndex: page.pdfPageIndex,
    view: {
      id: row.canonical_views.id,
      originalAssetId: row.canonical_views.originalAssetId,
      derivativeId: row.canonical_views.derivativeId,
      width: row.canonical_views.width,
      height: row.canonical_views.height,
      originalCoordinateSpace: row.canonical_views
        .coordinateSpace as SourcePage['view']['originalCoordinateSpace'],
      transformToOriginal: row.canonical_views
        .transformToOriginal as SourcePage['view']['transformToOriginal'],
    },
    presentation: row.source_version_assets?.presentation
      ? (row.source_version_assets.presentation as SourcePage['presentation'])
      : null,
    rawText: parsed?.rawText ?? '',
    searchText: parsed?.searchText ?? '',
    quality: parsed
      ? (parsed.quality as SourcePage['quality'])
      : 'needs_review',
    regionIds: regions.map((region) => region.id),
  };
}

async function readRegion(
  tx: Transaction,
  ownerId: string,
  id: string,
): Promise<SourceRegion | null> {
  const [row] = await tx
    .select()
    .from(sourceRegions)
    .innerJoin(
      sourceVersions,
      and(
        eq(sourceRegions.sourceVersionId, sourceVersions.id),
        eq(sourceVersions.ownerId, ownerId),
      ),
    )
    .where(eq(sourceRegions.id, id));
  if (!row) {
    return null;
  }
  const relations = await tx
    .select({ id: regionRelations.toId })
    .from(regionRelations)
    .where(eq(regionRelations.fromId, id));

  return {
    id: row.source_regions.id,
    sourceVersionId: row.source_regions.sourceVersionId,
    pageId: row.source_regions.pageId,
    kind: row.source_regions.kind as SourceRegion['kind'],
    region: row.source_regions.geometry as SourceRegion['region'],
    rawText: row.source_regions.rawText,
    relatedRegionIds: relations.map((relation) => relation.id),
  };
}

async function saveAssets(
  tx: Transaction,
  ownerId: string,
  versionId: string,
  assets: readonly SourceRegistrationAsset[],
): Promise<void> {
  for (const asset of assets) {
    const [moved] = await tx
      .update(mediaAssets)
      .set({ sourceIntakeId: null, sourceVersionId: versionId })
      .where(
        and(
          eq(mediaAssets.id, asset.assetId),
          eq(mediaAssets.ownerId, ownerId),
          isNull(mediaAssets.sourceVersionId),
        ),
      )
      .returning({ id: mediaAssets.id });
    if (!moved) {
      throw new Error('Source asset is inaccessible or already registered');
    }
  }
  if (assets.length) {
    await tx.insert(sourceVersionAssets).values(
      assets.map((asset) => ({
        versionId,
        assetId: asset.assetId,
        ordinal: asset.order,
        printedLabel: asset.printedPageLabel,
        presentation: asset.presentation ?? null,
      })),
    );
  }
}

async function saveSourceMetadata(
  tx: Transaction,
  source: Source,
): Promise<void> {
  if (source.metadata.contributors.length) {
    await tx.insert(sourceContributors).values(
      source.metadata.contributors.map((contributor, ordinal) => ({
        sourceId: source.id,
        ordinal,
        ...contributor,
      })),
    );
  }
  if (source.metadata.languages.length) {
    await tx.insert(sourceLanguages).values(
      source.metadata.languages.map((language) => ({
        sourceId: source.id,
        language,
      })),
    );
  }
}

/**
 * stores immutable source versions, parsed locators and citations for one collector
 * @param tx transaction shared by all repository operations
 * @param ownerId owner whose source records the repository may access
 * @returns source repository bound to the transaction and owner
 */
export function createSourceRepository(
  tx: Transaction,
  ownerId: string,
): SourceRepository {
  async function getVersion(id: string): Promise<SourceVersion | null> {
    return readVersion(tx, ownerId, id);
  }

  async function addProviderChunkMappings(
    index: IndexIdentity,
    mappings: readonly ProviderChunkMapping[],
  ): Promise<void> {
    if (
      mappings.some((mapping) => mapping.indexVersion !== index.indexVersion)
    ) {
      throw new Error('Provider mapping index identity does not match');
    }
    const persistedIndexId = indexVersionId(index.indexVersion);
    await tx
      .insert(indexVersions)
      .values({
        id: persistedIndexId,
        kind: 'text',
        embeddingModelId: index.embeddingModelId,
        dimensions: index.dimensions,
        status: 'active',
      })
      .onConflictDoNothing();
    const [persistedIndex] = await tx
      .select()
      .from(indexVersions)
      .where(eq(indexVersions.id, persistedIndexId));
    if (
      !persistedIndex ||
      persistedIndex.kind !== 'text' ||
      persistedIndex.embeddingModelId !== index.embeddingModelId ||
      persistedIndex.dimensions !== index.dimensions
    ) {
      throw new Error('Provider mapping index identity conflicts');
    }

    await persistProviderChunkMappings(persistedIndexId, mappings);
  }

  async function persistProviderChunkMappings(
    persistedIndexId: string,
    mappings: readonly ProviderChunkMapping[],
  ): Promise<void> {
    for (const mapping of mappings) {
      const [existing] = await tx
        .select()
        .from(sourceChunkMappings)
        .where(
          and(
            eq(sourceChunkMappings.provider, mapping.provider),
            eq(sourceChunkMappings.indexId, persistedIndexId),
            eq(sourceChunkMappings.providerChunkId, mapping.providerChunkId),
          ),
        );
      let mappingId = existing?.id;
      if (existing) {
        if (
          existing.parseRunId !== mapping.parseRunId ||
          existing.sourceVersionId !== mapping.sourceVersionId ||
          existing.providerFigureId !== mapping.providerFigureId
        ) {
          throw new Error(
            'Provider chunk identity was reused for different source content',
          );
        }
      } else {
        const [version] = await tx
          .select({ id: sourceVersions.id })
          .from(sourceVersions)
          .where(
            and(
              eq(sourceVersions.id, mapping.sourceVersionId),
              eq(sourceVersions.ownerId, ownerId),
            ),
          );
        if (!version) {
          throw new Error('Provider chunk source version is inaccessible');
        }
        mappingId = randomUUID();
        await tx.insert(sourceChunkMappings).values({
          id: mappingId,
          provider: mapping.provider,
          indexId: persistedIndexId,
          parseRunId: mapping.parseRunId,
          providerChunkId: mapping.providerChunkId,
          providerFigureId: mapping.providerFigureId,
          sourceVersionId: mapping.sourceVersionId,
        });
      }
      if (mapping.canonicalRegionIds.length) {
        await tx
          .insert(mappingRegions)
          .values(
            mapping.canonicalRegionIds.map((regionId) => ({
              mappingId: mappingId!,
              regionId,
            })),
          )
          .onConflictDoNothing();
      }
    }
  }

  async function addCitation(citation: SourceCitation): Promise<void> {
    const version = await getVersion(citation.locator.sourceVersionId);
    if (!version || version.sourceId !== citation.locator.sourceId) {
      throw new Error('Citation source is inaccessible');
    }
    await writeSourceLocator(tx, citation.id, citation.locator);
    await tx
      .insert(citations)
      .values({
        id: citation.id,
        locatorId: citation.id,
        relation: citation.relation,
        availability: citation.availability,
        verification: citation.verification,
      })
      .onConflictDoNothing();
  }

  return {
    async get(
      id,
      versionId,
      pageId,
      cursor,
      requestedLimit,
    ): Promise<SourceDetail | null> {
      const [row] = await tx
        .select()
        .from(sources)
        .where(and(eq(sources.id, id), eq(sources.ownerId, ownerId)));
      if (!row) {
        return null;
      }
      const [contributors, languages] = await Promise.all([
        tx
          .select()
          .from(sourceContributors)
          .where(eq(sourceContributors.sourceId, id))
          .orderBy(asc(sourceContributors.ordinal)),
        tx
          .select()
          .from(sourceLanguages)
          .where(eq(sourceLanguages.sourceId, id))
          .orderBy(asc(sourceLanguages.language)),
      ]);
      const source = toSource(
        row,
        contributors.map(({ nameAsPrinted, role, attribution }) => ({
          nameAsPrinted,
          role: role as Source['metadata']['contributors'][number]['role'],
          attribution:
            attribution as Source['metadata']['contributors'][number]['attribution'],
        })),
        languages.map((language) => language.language),
      );
      const version = await getVersion(versionId ?? source.currentVersionId);
      if (!version || version.sourceId !== id) {
        return null;
      }
      const limit = Math.min(Math.max(requestedLimit ?? 20, 1), 100);
      const position = cursor ? decodeCursor(cursor) : null;
      const pageRows = pageId
        ? await tx
            .select({ id: sourcePages.id, pageIndex: sourcePages.pageIndex })
            .from(sourcePages)
            .where(
              and(
                eq(sourcePages.id, pageId),
                eq(sourcePages.sourceVersionId, version.id),
              ),
            )
            .limit(1)
        : await tx
            .select({ id: sourcePages.id, pageIndex: sourcePages.pageIndex })
            .from(sourcePages)
            .where(
              and(
                eq(sourcePages.sourceVersionId, version.id),
                position
                  ? sql`(${sourcePages.pageIndex}, ${sourcePages.id}) > (${position.pageIndex}, ${position.id})`
                  : undefined,
              ),
            )
            .orderBy(asc(sourcePages.pageIndex), asc(sourcePages.id))
            .limit(limit + 1);
      const selected = pageRows.slice(0, limit);
      const pages = (
        await Promise.all(
          selected.map(async (page) => readPage(tx, ownerId, page.id)),
        )
      ).filter((page): page is SourcePage => page !== null);
      const selectedRegionIds = pages.flatMap((page) => page.regionIds);
      const regionRows = selectedRegionIds.length
        ? await tx
            .select({ id: sourceRegions.id })
            .from(sourceRegions)
            .where(
              and(
                eq(sourceRegions.sourceVersionId, version.id),
                inArray(sourceRegions.id, selectedRegionIds),
              ),
            )
        : [];
      const regions = (
        await Promise.all(
          regionRows.map(async (region) => readRegion(tx, ownerId, region.id)),
        )
      ).filter((region): region is SourceRegion => region !== null);
      const imageRows = await tx
        .select({ id: referenceImages.id })
        .from(referenceImages)
        .where(eq(referenceImages.sourceVersionId, version.id))
        .orderBy(asc(referenceImages.id));
      const images = (
        await Promise.all(
          imageRows.map(async (image) =>
            readReferenceImage(tx, ownerId, image.id),
          ),
        )
      ).filter((image): image is ReferenceImage => image !== null);
      const [job] = await tx
        .select({ id: jobs.id })
        .from(jobs)
        .where(
          and(
            eq(jobs.ownerId, ownerId),
            eq(jobs.kind, 'sourceIngestion'),
            eq(jobs.resourceId, version.id),
          ),
        )
        .orderBy(desc(jobs.createdAt))
        .limit(1);
      const drafts = await tx
        .select({ id: sourceKnowledgeDrafts.entryId })
        .from(sourceKnowledgeDrafts)
        .where(
          and(
            eq(sourceKnowledgeDrafts.ownerId, ownerId),
            eq(sourceKnowledgeDrafts.sourceVersionId, version.id),
          ),
        )
        .orderBy(asc(sourceKnowledgeDrafts.entryId));
      const last = selected.at(-1);

      return sourceDetailSchema.parse({
        source,
        version,
        pages: {
          items: pages,
          nextCursor:
            !pageId && pageRows.length > limit && last
              ? encodeCursor({ pageIndex: last.pageIndex, id: last.id })
              : null,
        },
        regions,
        referenceImages: images,
        reads: [],
        processingJobId: job?.id ?? null,
        knowledgeDraftIds: drafts.map((draft) => draft.id),
      });
    },
    getVersion,
    async getReadTargets(sourceVersionId, pageIds) {
      const selectedPageIds = pageIds ? [...new Set(pageIds)] : undefined;
      const originals = selectedPageIds
        ? selectedPageIds.length
          ? await tx
              .select({
                assetOrDerivativeId: mediaAssets.id,
                storageKey: mediaAssets.objectKey,
              })
              .from(sourcePages)
              .innerJoin(
                sourceVersions,
                and(
                  eq(sourcePages.sourceVersionId, sourceVersions.id),
                  eq(sourceVersions.ownerId, ownerId),
                ),
              )
              .innerJoin(
                sourceVersionAssets,
                and(
                  eq(
                    sourceVersionAssets.versionId,
                    sourcePages.sourceVersionId,
                  ),
                  eq(sourceVersionAssets.assetId, sourcePages.originalAssetId),
                ),
              )
              .innerJoin(
                mediaAssets,
                and(
                  eq(sourcePages.originalAssetId, mediaAssets.id),
                  eq(mediaAssets.ownerId, ownerId),
                ),
              )
              .where(
                and(
                  eq(sourcePages.sourceVersionId, sourceVersionId),
                  inArray(sourcePages.id, selectedPageIds),
                ),
              )
              .orderBy(asc(sourcePages.pageIndex), asc(mediaAssets.id))
          : []
        : await tx
            .select({
              assetOrDerivativeId: mediaAssets.id,
              storageKey: mediaAssets.objectKey,
            })
            .from(sourceVersionAssets)
            .innerJoin(
              sourceVersions,
              and(
                eq(sourceVersionAssets.versionId, sourceVersions.id),
                eq(sourceVersions.ownerId, ownerId),
              ),
            )
            .innerJoin(
              mediaAssets,
              and(
                eq(sourceVersionAssets.assetId, mediaAssets.id),
                eq(mediaAssets.ownerId, ownerId),
              ),
            )
            .where(eq(sourceVersionAssets.versionId, sourceVersionId))
            .orderBy(asc(sourceVersionAssets.ordinal));
      if (!selectedPageIds?.length) {
        return originals;
      }

      const [pageDerivatives, referenceDerivatives] = await Promise.all([
        tx
          .select({
            assetOrDerivativeId: mediaDerivatives.id,
            storageKey: mediaDerivatives.objectKey,
          })
          .from(sourcePages)
          .innerJoin(
            sourceVersions,
            and(
              eq(sourcePages.sourceVersionId, sourceVersions.id),
              eq(sourceVersions.ownerId, ownerId),
            ),
          )
          .innerJoin(
            canonicalViews,
            eq(sourcePages.canonicalViewId, canonicalViews.id),
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
              eq(sourcePages.sourceVersionId, sourceVersionId),
              inArray(sourcePages.id, selectedPageIds),
            ),
          )
          .orderBy(asc(sourcePages.pageIndex), asc(mediaDerivatives.id)),
        tx
          .select({
            assetOrDerivativeId: mediaDerivatives.id,
            storageKey: mediaDerivatives.objectKey,
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
            sourceLocators,
            eq(referenceImages.locatorId, sourceLocators.id),
          )
          .innerJoin(
            mediaDerivatives,
            and(
              eq(referenceImages.storedDerivativeId, mediaDerivatives.id),
              eq(mediaDerivatives.ownerId, ownerId),
            ),
          )
          .where(
            and(
              eq(referenceImages.sourceVersionId, sourceVersionId),
              inArray(sourceLocators.pageId, selectedPageIds),
            ),
          )
          .orderBy(asc(referenceImages.id)),
      ]);
      const targets = new Map(
        [...originals, ...pageDerivatives, ...referenceDerivatives].map(
          (target) => [target.assetOrDerivativeId, target],
        ),
      );

      return [...targets.values()];
    },
    async findVersionByHash(sourceHash) {
      const [row] = await tx
        .select({ id: sourceVersions.id })
        .from(sourceVersions)
        .where(
          and(
            eq(sourceVersions.ownerId, ownerId),
            eq(sourceVersions.sourceHash, sourceHash),
          ),
        );

      return row ? getVersion(row.id) : null;
    },
    async getIngestionJobId(versionId) {
      const [row] = await tx
        .select({ id: jobs.id })
        .from(jobs)
        .where(
          and(
            eq(jobs.ownerId, ownerId),
            eq(jobs.kind, 'sourceIngestion'),
            eq(jobs.resourceId, versionId),
          ),
        )
        .orderBy(asc(jobs.createdAt))
        .limit(1);

      return row?.id ?? null;
    },
    async getPage(id) {
      return readPage(tx, ownerId, id);
    },
    async getPageRunSelection(versionId) {
      const rows = await tx
        .select({
          pageId: sourcePages.id,
          parseRunId: projectedParseRunId(),
        })
        .from(sourcePages)
        .innerJoin(
          sourceVersions,
          and(
            eq(sourcePages.sourceVersionId, sourceVersions.id),
            eq(sourceVersions.ownerId, ownerId),
          ),
        )
        .where(eq(sourcePages.sourceVersionId, versionId))
        .orderBy(asc(sourcePages.pageIndex), asc(sourcePages.id));

      return rows;
    },
    async create(source, version, assets) {
      await tx.insert(sources).values({
        id: source.id,
        ownerId,
        kind: source.kind,
        revision: source.revision,
        currentVersionId: source.currentVersionId,
        title: source.metadata.title,
        authorStatus: source.metadata.authorStatus,
        editionStatement: source.metadata.editionStatement,
        publisher: source.metadata.publisher,
        publicationDateAsPrinted: source.metadata.publicationDateAsPrinted,
        isbn: source.metadata.isbn,
        canonicalUrl: source.metadata.canonicalUrl,
        access: source.metadata.access,
        rightsStatement: source.metadata.rightsStatement,
        attributionText: source.metadata.attributionText,
        createdAt: source.createdAt,
        updatedAt: source.updatedAt,
      });
      await saveSourceMetadata(tx, source);
      await tx.insert(sourceVersions).values({
        id: version.id,
        sourceId: version.sourceId,
        ownerId,
        sourceHash: version.sourceHash,
        metadataSnapshot: version.metadataSnapshot,
        capturedAt: version.capturedAt,
        retrievedAt: version.retrievedAt,
        status: version.status,
        textIndexStatus: version.textIndexStatus,
        imageIndexStatus: version.imageIndexStatus,
        activeParseRunId: version.activeParseRunId,
      });
      await saveAssets(tx, ownerId, version.id, assets);
    },
    async addVersion(version, expectedSourceRevision, assets) {
      const metadata = version.metadataSnapshot;
      const [changed] = await tx
        .update(sources)
        .set({
          revision: expectedSourceRevision + 1,
          currentVersionId: version.id,
          title: metadata.title,
          authorStatus: metadata.authorStatus,
          editionStatement: metadata.editionStatement,
          publisher: metadata.publisher,
          publicationDateAsPrinted: metadata.publicationDateAsPrinted,
          isbn: metadata.isbn,
          canonicalUrl: metadata.canonicalUrl,
          access: metadata.access,
          rightsStatement: metadata.rightsStatement,
          attributionText: metadata.attributionText,
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(sources.id, version.sourceId),
            eq(sources.ownerId, ownerId),
            eq(sources.revision, expectedSourceRevision),
          ),
        )
        .returning({ id: sources.id });
      if (!changed) {
        return false;
      }
      await tx
        .delete(sourceContributors)
        .where(eq(sourceContributors.sourceId, version.sourceId));
      await tx
        .delete(sourceLanguages)
        .where(eq(sourceLanguages.sourceId, version.sourceId));
      await saveSourceMetadata(tx, {
        id: version.sourceId,
        revision: expectedSourceRevision + 1,
        createdAt: version.capturedAt,
        updatedAt: version.capturedAt,
        kind: 'book_pages',
        metadata,
        currentVersionId: version.id,
      });
      await tx.insert(sourceVersions).values({
        id: version.id,
        sourceId: version.sourceId,
        ownerId,
        sourceHash: version.sourceHash,
        metadataSnapshot: metadata,
        capturedAt: version.capturedAt,
        retrievedAt: version.retrievedAt,
        status: version.status,
        textIndexStatus: version.textIndexStatus,
        imageIndexStatus: version.imageIndexStatus,
        activeParseRunId: version.activeParseRunId,
      });
      await saveAssets(tx, ownerId, version.id, assets);

      return true;
    },
    async updateVersion(version, expectedStatus, expectedActiveParseRunId) {
      const [changed] = await tx
        .update(sourceVersions)
        .set({
          status: version.status,
          textIndexStatus: version.textIndexStatus,
          imageIndexStatus: version.imageIndexStatus,
          activeParseRunId: version.activeParseRunId,
        })
        .where(
          and(
            eq(sourceVersions.id, version.id),
            eq(sourceVersions.ownerId, ownerId),
            eq(sourceVersions.status, expectedStatus),
            expectedActiveParseRunId === null
              ? isNull(sourceVersions.activeParseRunId)
              : eq(sourceVersions.activeParseRunId, expectedActiveParseRunId),
          ),
        )
        .returning({ id: sourceVersions.id });

      return Boolean(changed);
    },
    async saveParsed(pack) {
      const version = await getVersion(pack.sourceVersionId);
      if (!version) {
        throw new Error('Parsed source version is inaccessible');
      }
      await tx
        .insert(parseRuns)
        .values({
          id: pack.parseRunId,
          sourceVersionId: pack.sourceVersionId,
          jobId: pack.parseRunId,
          provider: 'application',
          rawOutputAssetId: pack.rawOutputAssetId,
          status: pack.warnings.length ? 'partial' : 'completed',
        })
        .onConflictDoNothing();
      await tx
        .insert(sourceArtifacts)
        .values({
          assetId: pack.rawOutputAssetId,
          ownerId,
          sourceVersionId: pack.sourceVersionId,
          parseRunId: pack.parseRunId,
          kind: 'raw_parse_output',
        })
        .onConflictDoNothing();
      for (const page of pack.pages) {
        const [ownedAsset] = await tx
          .select({ id: mediaAssets.id })
          .from(sourceVersionAssets)
          .innerJoin(
            mediaAssets,
            and(
              eq(sourceVersionAssets.assetId, mediaAssets.id),
              eq(mediaAssets.ownerId, ownerId),
            ),
          )
          .where(
            and(
              eq(sourceVersionAssets.versionId, pack.sourceVersionId),
              eq(sourceVersionAssets.assetId, page.originalAssetId),
            ),
          );
        if (!ownedAsset) {
          throw new Error('Parsed page asset is inaccessible');
        }

        if (page.pdfPageIndex !== null) {
          await tx
            .insert(canonicalViews)
            .values({
              id: page.view.id,
              originalAssetId: page.view.originalAssetId,
              derivativeId: null,
              width: page.view.width,
              height: page.view.height,
              coordinateSpace: page.view.originalCoordinateSpace,
              transformToOriginal: page.view.transformToOriginal,
            })
            .onConflictDoNothing();
        }
        const [storedView] = await tx
          .select()
          .from(canonicalViews)
          .innerJoin(
            mediaAssets,
            and(
              eq(canonicalViews.originalAssetId, mediaAssets.id),
              eq(mediaAssets.ownerId, ownerId),
            ),
          )
          .where(
            and(
              eq(canonicalViews.id, page.view.id),
              eq(canonicalViews.originalAssetId, page.originalAssetId),
            ),
          );
        const view = storedView?.canonical_views;
        const expectedDerivativeId =
          page.pdfPageIndex !== null ? null : page.view.derivativeId;
        const transform = view?.transformToOriginal as
          readonly number[] | undefined;
        if (
          !view ||
          page.view.originalAssetId !== page.originalAssetId ||
          view.derivativeId !== expectedDerivativeId ||
          view.width !== page.view.width ||
          view.height !== page.view.height ||
          view.coordinateSpace !== page.view.originalCoordinateSpace ||
          !transform ||
          transform.length !== page.view.transformToOriginal.length ||
          page.view.transformToOriginal.some(
            (value, index) => transform[index] !== value,
          )
        ) {
          throw new Error('Parsed page canonical view is inaccessible');
        }

        await tx
          .insert(sourcePages)
          .values({
            id: page.id,
            sourceVersionId: page.sourceVersionId,
            pageIndex: page.pageIndex,
            printedPageLabel: page.printedPageLabel,
            originalAssetId: page.originalAssetId,
            pdfPageIndex: page.pdfPageIndex,
            canonicalViewId: page.view.id,
          })
          .onConflictDoNothing();
        const [storedPage] = await tx
          .select()
          .from(sourcePages)
          .where(eq(sourcePages.id, page.id));
        if (
          !storedPage ||
          storedPage.sourceVersionId !== page.sourceVersionId ||
          storedPage.pageIndex !== page.pageIndex ||
          storedPage.printedPageLabel !== page.printedPageLabel ||
          storedPage.originalAssetId !== page.originalAssetId ||
          storedPage.pdfPageIndex !== page.pdfPageIndex ||
          storedPage.canonicalViewId !== page.view.id
        ) {
          throw new Error('Parsed page identity conflicts with the original');
        }
        await tx
          .insert(sourcePageParses)
          .values({
            parseRunId: pack.parseRunId,
            pageId: page.id,
            rawText: page.rawText,
            searchText: page.searchText,
            quality: page.quality,
          })
          .onConflictDoUpdate({
            target: [sourcePageParses.parseRunId, sourcePageParses.pageId],
            set: {
              rawText: page.rawText,
              searchText: page.searchText,
              quality: page.quality,
            },
          });
      }
      for (const region of pack.regions) {
        await tx
          .insert(sourceRegions)
          .values({
            id: region.id,
            sourceVersionId: region.sourceVersionId,
            pageId: region.pageId,
            parseRunId: pack.parseRunId,
            kind: region.kind,
            geometry: region.region,
            rawText: region.rawText,
          })
          .onConflictDoNothing();
        const [storedRegion] = await tx
          .select({ id: sourceRegions.id })
          .from(sourceRegions)
          .where(
            and(
              eq(sourceRegions.id, region.id),
              eq(sourceRegions.sourceVersionId, region.sourceVersionId),
              eq(sourceRegions.pageId, region.pageId),
              eq(sourceRegions.parseRunId, pack.parseRunId),
              eq(sourceRegions.kind, region.kind),
              eq(sourceRegions.geometry, region.region),
              region.rawText === null
                ? isNull(sourceRegions.rawText)
                : eq(sourceRegions.rawText, region.rawText),
            ),
          );
        if (!storedRegion) {
          throw new Error('Parsed region identity conflicts with the original');
        }
      }
      for (const region of pack.regions) {
        if (region.relatedRegionIds.length) {
          await tx
            .insert(regionRelations)
            .values(
              region.relatedRegionIds.map((toId) => ({
                fromId: region.id,
                toId,
                kind: 'related',
              })),
            )
            .onConflictDoNothing();
        }
      }
      const pagesById = new Map(pack.pages.map((page) => [page.id, page]));
      for (const region of pack.regions) {
        const page = pagesById.get(region.pageId);
        if (
          region.kind !== 'text' ||
          !region.rawText?.trim() ||
          page?.quality !== 'usable'
        ) {
          continue;
        }
        const citationId = stableUuid(`source-region:${region.id}:citation`);
        await addCitation({
          id: citationId,
          locator: {
            kind: 'page',
            sourceId: version.sourceId,
            sourceVersionId: version.id,
            pageId: page.id,
            pageIndex: page.pageIndex,
            printedPageLabel: page.printedPageLabel,
            canonicalViewId: page.view.id,
            regionId: region.id,
            region: region.region,
            textRange: null,
          },
          relation: 'background',
          availability: 'stored',
          verification: 'located',
        });
      }
      for (const image of pack.images) {
        await writeSourceLocator(tx, image.id, image.locator);
        const captionLocatorId = image.originalCaption
          ? stableUuid(`${image.id}:caption`)
          : null;
        if (image.originalCaption && captionLocatorId) {
          await writeSourceLocator(
            tx,
            captionLocatorId,
            image.originalCaption.locator,
          );
        }
        await tx
          .insert(referenceImages)
          .values({
            id: image.id,
            sourceVersionId: image.sourceVersionId,
            locatorId: image.id,
            figureRegionId: image.figureRegionId,
            storedDerivativeId: image.storedDerivativeId,
            externalImageUrl: image.externalImageUrl,
            captionText: image.originalCaption?.textAsPrinted,
            captionLocatorId,
            generatedDescriptionZhHant: image.generatedDescriptionZhHant,
            descriptionJobId: image.descriptionJobId,
            captionAssociation: image.captionAssociation,
          })
          .onConflictDoUpdate({
            target: referenceImages.id,
            set: {
              locatorId: image.id,
              figureRegionId: image.figureRegionId,
              storedDerivativeId: image.storedDerivativeId,
              externalImageUrl: image.externalImageUrl,
              captionText: image.originalCaption?.textAsPrinted,
              captionLocatorId,
              generatedDescriptionZhHant: image.generatedDescriptionZhHant,
              descriptionJobId: image.descriptionJobId,
              captionAssociation: image.captionAssociation,
            },
          });
      }
      for (const mapping of pack.mappings) {
        await persistProviderChunkMappings(
          indexVersionId(mapping.indexVersion),
          [mapping],
        );
      }
    },
    addProviderChunkMappings,
    async resolveProviderChunk(provider, indexVersion, providerChunkId) {
      const [row] = await tx
        .select()
        .from(sourceChunkMappings)
        .innerJoin(
          sourceVersions,
          and(
            eq(sourceChunkMappings.sourceVersionId, sourceVersions.id),
            eq(sourceVersions.ownerId, ownerId),
          ),
        )
        .where(
          and(
            eq(sourceChunkMappings.provider, provider),
            eq(sourceChunkMappings.indexId, indexVersionId(indexVersion)),
            eq(sourceChunkMappings.providerChunkId, providerChunkId),
          ),
        );
      if (!row) {
        return null;
      }
      const regions = await tx
        .select({ id: mappingRegions.regionId })
        .from(mappingRegions)
        .where(eq(mappingRegions.mappingId, row.source_chunk_mappings.id));

      return {
        provider: row.source_chunk_mappings.provider,
        providerChunkId: row.source_chunk_mappings.providerChunkId,
        providerFigureId: row.source_chunk_mappings.providerFigureId,
        parseRunId: row.source_chunk_mappings.parseRunId,
        indexVersion,
        sourceVersionId: row.source_chunk_mappings.sourceVersionId,
        canonicalRegionIds: regions.map((region) => region.id),
      };
    },
    async getCitation(id) {
      return readCitation(tx, ownerId, id);
    },
    addCitation,
    async linkKnowledgeDraft(versionId, entryId) {
      const version = await getVersion(versionId);
      if (!version) {
        throw new Error('Source version is inaccessible');
      }
      await tx
        .insert(sourceKnowledgeDrafts)
        .values({ ownerId, sourceVersionId: versionId, entryId })
        .onConflictDoNothing();
    },
  };
}
