import { createHash, randomUUID } from 'node:crypto';

import { sourceDetailSchema } from '@antica/contracts';

import { Prisma } from '../generated/client.js';

import { indexVersionId } from '../index-version.js';
import { jsonValue, nullableJson } from '../json.js';
import { projectedParseRunId } from '../source-projection.js';

import type {
  IndexIdentity,
  ProviderChunkMapping,
  SourceRegistrationAsset,
  SourceRepository,
} from '@antica/application/ports';
import type { SourceDetail } from '@antica/contracts';
import type {
  CanonicalView,
  ReferenceImage,
  Source,
  SourceCitation,
  SourceLocator,
  SourcePage,
  SourceRegion,
  SourceVersion,
} from '@antica/domain';

import type {
  sources,
  sourceVersions,
  sourcePages,
  mediaAssets,
  mediaDerivatives,
} from '../generated/client.js';

import type { Transaction } from '../transaction.js';

interface SourceVersionRow extends Omit<sourceVersions, 'metadataSnapshot'> {
  readonly metadataSnapshot: SourceVersion['metadataSnapshot'];
}

interface SourcePageRow extends sourcePages {
  readonly canonicalViews: CanonicalView;
}

type PageCursor = { readonly pageIndex: number; readonly id: string };

/** @param cursor */
function encodeCursor(cursor: PageCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

/** @param value */
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

/** @param value */
function stableUuid(value: string): string {
  const digest = createHash('sha256').update(value).digest('hex');

  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}

/** @param value */
function iso(value: Date | string): string {
  return new Date(value).toISOString();
}

/**
 * @param row
 * @param contributors
 * @param languages
 */
function toSource(
  row: sources,
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

/**
 * @param tx
 * @param ownerId
 * @param id
 */
async function readVersion(
  tx: Transaction,
  ownerId: string,
  id: string,
): Promise<SourceVersion | null> {
  const [row] = await tx.$queryRaw<SourceVersionRow[]>(Prisma.sql`
    select v."id" as "id",
      v."source_id" as "sourceId",
      v."owner_id" as "ownerId",
      v."source_hash" as "sourceHash",
      v."metadata_snapshot" as "metadataSnapshot",
      v."captured_at" as "capturedAt",
      v."retrieved_at" as "retrievedAt",
      v."status" as "status",
      v."text_index_status" as "textIndexStatus",
      v."image_index_status" as "imageIndexStatus",
      v."active_parse_run_id" as "activeParseRunId"
    from source_versions v
    where v.id = ${id}::uuid and v.owner_id = ${ownerId}
  `);
  if (!row) {
    return null;
  }
  const assets = await tx.sourceVersionAssets
    .findMany({
      where: { versionId: id },
      orderBy: [{ ordinal: 'asc' }],
      select: { assetId: true },
    })
    .then((rows) => rows.map((row) => ({ id: row.assetId })));

  return {
    id: row.id,
    sourceId: row.sourceId,
    originalAssetIds: assets.map((asset) => asset.id),
    sourceHash: row.sourceHash,
    metadataSnapshot: row.metadataSnapshot,
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
  const locator = await tx.sourceLocators.findFirst({
    where: { id, sources: { ownerId }, sourceVersions: { ownerId } },
  });
  if (!locator) {
    return null;
  }
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
  await tx.sourceLocators.createMany({
    data:
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
            geometry: nullableJson(locator.region),
            blockId: locator.textRange?.blockId,
            rangeStart: locator.textRange?.start,
            rangeEnd: locator.textRange?.end,
          },
    skipDuplicates: true,
  });
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
  const [row] = await tx.citations.findMany({ where: { id } });
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
  const row = await tx.referenceImages.findFirst({
    where: { id, sourceVersions: { ownerId } },
  });
  if (!row) {
    return null;
  }
  const locator = await readSourceLocator(tx, ownerId, row.locatorId);
  if (!locator) {
    return null;
  }
  const captionLocator = row.captionLocatorId
    ? await readSourceLocator(tx, ownerId, row.captionLocatorId)
    : null;

  return {
    id: row.id,
    sourceVersionId: row.sourceVersionId,
    locator,
    figureRegionId: row.figureRegionId,
    storedDerivativeId: row.storedDerivativeId,
    externalImageUrl: row.externalImageUrl,
    originalCaption:
      row.captionText && captionLocator
        ? {
            textAsPrinted: row.captionText,
            locator: captionLocator,
          }
        : null,
    generatedDescriptionZhHant: row.generatedDescriptionZhHant,
    descriptionJobId: row.descriptionJobId,
    captionAssociation:
      row.captionAssociation as ReferenceImage['captionAssociation'],
  };
}

/**
 * @param tx
 * @param ownerId
 * @param id
 */
async function readPage(
  tx: Transaction,
  ownerId: string,
  id: string,
): Promise<SourcePage | null> {
  const [page] = await tx.$queryRaw<SourcePageRow[]>(Prisma.sql`
    select p."id" as "id",
      p."source_version_id" as "sourceVersionId",
      p."page_index" as "pageIndex",
      p."printed_page_label" as "printedPageLabel",
      p."original_asset_id" as "originalAssetId",
      p."pdf_page_index" as "pdfPageIndex",
      p."canonical_view_id" as "canonicalViewId",
      jsonb_build_object(
        'id', v.id, 'originalAssetId', v.original_asset_id,
        'derivativeId', v.derivative_id, 'width', v.width, 'height', v.height,
        'originalCoordinateSpace', v.coordinate_space,
        'transformToOriginal', v.transform_to_original
      ) as "canonicalViews"
    from source_pages p
    join source_versions s on s.id = p.source_version_id
    join canonical_views v on v.id = p.canonical_view_id
    where p.id = ${id}::uuid and s.owner_id = ${ownerId}
  `);
  if (!page) {
    return null;
  }
  const registration = await tx.sourceVersionAssets.findUnique({
    where: {
      versionId_assetId: {
        versionId: page.sourceVersionId,
        assetId: page.originalAssetId,
      },
    },
    select: { presentation: true },
  });
  const [selection] = await tx.$queryRaw<
    Array<{ parseRunId: string | null }>
  >(Prisma.sql`
    select ${projectedParseRunId()} as "parseRunId"
    from source_pages
    join source_versions on source_pages.source_version_id = source_versions.id
    where (source_pages.id = ${id}::uuid and source_versions.owner_id = ${ownerId})
  `);
  const parseRunId = selection?.parseRunId;
  const [parsed] = parseRunId
    ? await tx.sourcePageParses.findMany({
        where: { AND: [{ pageId: id }, { parseRunId }] },
      })
    : [];
  const regions = parseRunId
    ? await tx.sourceRegions.findMany({
        where: { AND: [{ pageId: id }, { parseRunId }] },
        select: { id: true },
      })
    : [];

  return {
    id: page.id,
    sourceVersionId: page.sourceVersionId,
    pageIndex: page.pageIndex,
    printedPageLabel: page.printedPageLabel,
    originalAssetId: page.originalAssetId,
    pdfPageIndex: page.pdfPageIndex,
    view: {
      id: page.canonicalViews.id,
      originalAssetId: page.canonicalViews.originalAssetId,
      derivativeId: page.canonicalViews.derivativeId,
      width: page.canonicalViews.width,
      height: page.canonicalViews.height,
      originalCoordinateSpace: page.canonicalViews.originalCoordinateSpace,
      transformToOriginal: page.canonicalViews.transformToOriginal,
    },
    presentation: registration?.presentation
      ? (registration.presentation as SourcePage['presentation'])
      : null,
    rawText: parsed?.rawText ?? '',
    searchText: parsed?.searchText ?? '',
    quality: parsed
      ? (parsed.quality as SourcePage['quality'])
      : 'needs_review',
    regionIds: regions.map((region) => region.id),
  };
}

/**
 * @param tx
 * @param ownerId
 * @param id
 */
async function readRegion(
  tx: Transaction,
  ownerId: string,
  id: string,
): Promise<SourceRegion | null> {
  const row = await tx.sourceRegions.findFirst({
    where: { id, sourceVersions: { ownerId } },
  });
  if (!row) {
    return null;
  }
  const relations = await tx.regionRelations
    .findMany({ where: { fromId: id }, select: { toId: true } })
    .then((rows) => rows.map((row) => ({ id: row.toId })));

  return {
    id: row.id,
    sourceVersionId: row.sourceVersionId,
    pageId: row.pageId,
    kind: row.kind as SourceRegion['kind'],
    region: row.geometry as SourceRegion['region'],
    rawText: row.rawText,
    relatedRegionIds: relations.map((relation) => relation.id),
  };
}

/**
 * @param tx
 * @param ownerId
 * @param versionId
 * @param assets
 */
async function saveAssets(
  tx: Transaction,
  ownerId: string,
  versionId: string,
  assets: readonly SourceRegistrationAsset[],
): Promise<void> {
  for (const asset of assets) {
    const [moved] = await tx.mediaAssets.updateManyAndReturn({
      data: { sourceIntakeId: null, sourceVersionId: versionId },
      where: {
        AND: [{ id: asset.assetId }, { ownerId }, { sourceVersionId: null }],
      },
      select: { id: true },
    });
    if (!moved) {
      throw new Error('Source asset is inaccessible or already registered');
    }
  }
  if (assets.length) {
    await tx.sourceVersionAssets.createMany({
      data: assets.map((asset) => ({
        versionId,
        assetId: asset.assetId,
        ordinal: asset.order,
        printedLabel: asset.printedPageLabel,
        presentation: nullableJson(asset.presentation ?? null),
      })),
    });
  }
}

/**
 * @param tx
 * @param source
 */
async function saveSourceMetadata(
  tx: Transaction,
  source: Source,
): Promise<void> {
  if (source.metadata.contributors.length) {
    await tx.sourceContributors.createMany({
      data: source.metadata.contributors.map((contributor, ordinal) => ({
        sourceId: source.id,
        ordinal,
        ...contributor,
      })),
    });
  }
  if (source.metadata.languages.length) {
    await tx.sourceLanguages.createMany({
      data: source.metadata.languages.map((language) => ({
        sourceId: source.id,
        language,
      })),
    });
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
    await tx.indexVersions.createMany({
      data: {
        id: persistedIndexId,
        kind: 'text',
        embeddingModelId: index.embeddingModelId,
        dimensions: index.dimensions,
        status: 'active',
      },
      skipDuplicates: true,
    });
    const [persistedIndex] = await tx.indexVersions.findMany({
      where: { id: persistedIndexId },
    });
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
      const [existing] = await tx.sourceChunkMappings.findMany({
        where: {
          AND: [
            { provider: mapping.provider },
            { indexId: persistedIndexId },
            { providerChunkId: mapping.providerChunkId },
          ],
        },
      });
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
        const [version] = await tx.sourceVersions.findMany({
          where: {
            AND: [{ id: mapping.sourceVersionId }, { ownerId }],
          },
          select: { id: true },
        });
        if (!version) {
          throw new Error('Provider chunk source version is inaccessible');
        }
        mappingId = randomUUID();
        await tx.sourceChunkMappings.createMany({
          data: {
            id: mappingId,
            provider: mapping.provider,
            indexId: persistedIndexId,
            parseRunId: mapping.parseRunId,
            providerChunkId: mapping.providerChunkId,
            providerFigureId: mapping.providerFigureId,
            sourceVersionId: mapping.sourceVersionId,
          },
        });
      }
      if (mapping.canonicalRegionIds.length) {
        await tx.mappingRegions.createMany({
          data: mapping.canonicalRegionIds.map((regionId) => ({
            mappingId: mappingId!,
            regionId,
          })),
          skipDuplicates: true,
        });
      }
    }
  }

  async function addCitation(citation: SourceCitation): Promise<void> {
    const version = await tx.sourceVersions.findFirst({
      where: { id: citation.locator.sourceVersionId, ownerId },
      select: { sourceId: true },
    });
    if (!version || version.sourceId !== citation.locator.sourceId) {
      throw new Error('Citation source is inaccessible');
    }
    await writeSourceLocator(tx, citation.id, citation.locator);
    await tx.citations.createMany({
      data: {
        id: citation.id,
        locatorId: citation.id,
        relation: citation.relation,
        availability: citation.availability,
        verification: citation.verification,
      },
      skipDuplicates: true,
    });
  }

  return {
    /**
     * @param id
     * @param versionId
     * @param pageId
     * @param cursor
     * @param requestedLimit
     */
    async get(
      id,
      versionId,
      pageId,
      cursor,
      requestedLimit,
    ): Promise<SourceDetail | null> {
      const [row] = await tx.sources.findMany({
        where: { AND: [{ id }, { ownerId }] },
      });
      if (!row) {
        return null;
      }
      const [contributors, languages] = await Promise.all([
        tx.sourceContributors.findMany({
          where: { sourceId: id },
          orderBy: [{ ordinal: 'asc' }],
        }),
        tx.sourceLanguages.findMany({
          where: { sourceId: id },
          orderBy: [{ language: 'asc' }],
        }),
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
        ? await tx.sourcePages.findMany({
            where: { AND: [{ id: pageId }, { sourceVersionId: version.id }] },
            take: 1,
            select: { id: true, pageIndex: true },
          })
        : await tx.$queryRaw<
            Array<{
              id: sourcePages['id'];
              pageIndex: sourcePages['pageIndex'];
            }>
          >(Prisma.sql`
          select source_pages.id as "id",
          source_pages.page_index as "pageIndex"
          from source_pages
          where (source_pages.source_version_id = ${version.id}::uuid and ${position ? Prisma.sql`(source_pages.page_index, source_pages.id) > (${position.pageIndex}::integer, ${position.id}::uuid)` : Prisma.sql`true`})
          order by source_pages.page_index asc, source_pages.id asc
          limit ${limit + 1}
        `);
      const selected = pageRows.slice(0, limit);
      const pages = (
        await Promise.all(
          selected.map(async (page) => readPage(tx, ownerId, page.id)),
        )
      ).filter((page): page is SourcePage => page !== null);
      const selectedRegionIds = pages.flatMap((page) => page.regionIds);
      const regionRows = selectedRegionIds.length
        ? await tx.sourceRegions.findMany({
            where: {
              AND: [
                { sourceVersionId: version.id },
                { id: { in: selectedRegionIds } },
              ],
            },
            select: { id: true },
          })
        : [];
      const regions = (
        await Promise.all(
          regionRows.map(async (region) => readRegion(tx, ownerId, region.id)),
        )
      ).filter((region): region is SourceRegion => region !== null);
      const imageRows = await tx.referenceImages.findMany({
        where: { sourceVersionId: version.id },
        orderBy: [{ id: 'asc' }],
        select: { id: true },
      });
      const images = (
        await Promise.all(
          imageRows.map(async (image) =>
            readReferenceImage(tx, ownerId, image.id),
          ),
        )
      ).filter((image): image is ReferenceImage => image !== null);
      const [job] = await tx.jobs.findMany({
        where: {
          AND: [
            { ownerId },
            { kind: 'sourceIngestion' },
            { resourceId: version.id },
          ],
        },
        orderBy: [{ createdAt: 'desc' }],
        take: 1,
        select: { id: true },
      });
      const drafts = await tx.sourceKnowledgeDrafts
        .findMany({
          where: {
            AND: [{ ownerId }, { sourceVersionId: version.id }],
          },
          orderBy: [{ entryId: 'asc' }],
          select: { entryId: true },
        })
        .then((rows) => rows.map((row) => ({ id: row.entryId })));
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
    /**
     * @param sourceVersionId
     * @param pageIds
     */
    async getReadTargets(sourceVersionId, pageIds) {
      const selectedPageIds = pageIds ? [...new Set(pageIds)] : undefined;
      const originals = selectedPageIds
        ? selectedPageIds.length
          ? await tx.$queryRaw<
              Array<{
                assetOrDerivativeId: mediaAssets['id'];
                storageKey: mediaAssets['objectKey'];
              }>
            >(Prisma.sql`
            select media_assets.id as "assetOrDerivativeId",
            media_assets.object_key as "storageKey"
            from source_pages
            join source_versions on (source_pages.source_version_id = source_versions.id and source_versions.owner_id = ${ownerId})
            join source_version_assets on (source_version_assets.version_id = source_pages.source_version_id and source_version_assets.asset_id = source_pages.original_asset_id)
            join media_assets on (source_pages.original_asset_id = media_assets.id and media_assets.owner_id = ${ownerId})
            where (source_pages.source_version_id = ${sourceVersionId}::uuid and source_pages.id in (${Prisma.join(selectedPageIds.map((value) => Prisma.sql`${value}::uuid`))}))
            order by source_pages.page_index asc, media_assets.id asc
          `)
          : []
        : await tx.$queryRaw<
            Array<{
              assetOrDerivativeId: mediaAssets['id'];
              storageKey: mediaAssets['objectKey'];
            }>
          >(Prisma.sql`
          select media_assets.id as "assetOrDerivativeId",
          media_assets.object_key as "storageKey"
          from source_version_assets
          join source_versions on (source_version_assets.version_id = source_versions.id and source_versions.owner_id = ${ownerId})
          join media_assets on (source_version_assets.asset_id = media_assets.id and media_assets.owner_id = ${ownerId})
          where source_version_assets.version_id = ${sourceVersionId}::uuid
          order by source_version_assets.ordinal asc
        `);
      if (!selectedPageIds?.length) {
        return originals;
      }

      const [pageDerivatives, referenceDerivatives] = await Promise.all([
        tx.$queryRaw<
          Array<{
            assetOrDerivativeId: mediaDerivatives['id'];
            storageKey: mediaDerivatives['objectKey'];
          }>
        >(Prisma.sql`
          select media_derivatives.id as "assetOrDerivativeId",
          media_derivatives.object_key as "storageKey"
          from source_pages
          join source_versions on (source_pages.source_version_id = source_versions.id and source_versions.owner_id = ${ownerId})
          join canonical_views on source_pages.canonical_view_id = canonical_views.id
          join media_derivatives on (canonical_views.derivative_id = media_derivatives.id and media_derivatives.owner_id = ${ownerId})
          where (source_pages.source_version_id = ${sourceVersionId}::uuid and source_pages.id in (${Prisma.join(selectedPageIds.map((value) => Prisma.sql`${value}::uuid`))}))
          order by source_pages.page_index asc, media_derivatives.id asc
        `),
        tx.$queryRaw<
          Array<{
            assetOrDerivativeId: mediaDerivatives['id'];
            storageKey: mediaDerivatives['objectKey'];
          }>
        >(Prisma.sql`
          select media_derivatives.id as "assetOrDerivativeId",
          media_derivatives.object_key as "storageKey"
          from reference_images
          join source_versions on (reference_images.source_version_id = source_versions.id and source_versions.owner_id = ${ownerId})
          join source_locators on reference_images.locator_id = source_locators.id
          join media_derivatives on (reference_images.stored_derivative_id = media_derivatives.id and media_derivatives.owner_id = ${ownerId})
          where (reference_images.source_version_id = ${sourceVersionId}::uuid and source_locators.page_id in (${Prisma.join(selectedPageIds.map((value) => Prisma.sql`${value}::uuid`))}))
          order by reference_images.id asc
        `),
      ]);
      const targets = new Map(
        [...originals, ...pageDerivatives, ...referenceDerivatives].map(
          (target) => [target.assetOrDerivativeId, target],
        ),
      );

      return [...targets.values()];
    },
    /** @param sourceHash */
    async findVersionByHash(sourceHash) {
      const [row] = await tx.sourceVersions.findMany({
        where: { AND: [{ ownerId }, { sourceHash }] },
        select: { id: true },
      });

      return row ? getVersion(row.id) : null;
    },
    /** @param versionId */
    async getIngestionJobId(versionId) {
      const [row] = await tx.jobs.findMany({
        where: {
          AND: [
            { ownerId },
            { kind: 'sourceIngestion' },
            { resourceId: versionId },
          ],
        },
        orderBy: [{ createdAt: 'asc' }],
        take: 1,
        select: { id: true },
      });

      return row?.id ?? null;
    },
    /** @param id */
    async getPage(id) {
      return readPage(tx, ownerId, id);
    },
    /** @param versionId */
    async getPageRunSelection(versionId) {
      const rows = await tx.$queryRaw<
        Array<{ pageId: sourcePages['id']; parseRunId: string | null }>
      >(Prisma.sql`
        select source_pages.id as "pageId",
        ${projectedParseRunId()} as "parseRunId"
        from source_pages
        join source_versions on (source_pages.source_version_id = source_versions.id and source_versions.owner_id = ${ownerId})
        where source_pages.source_version_id = ${versionId}::uuid
        order by source_pages.page_index asc, source_pages.id asc
      `);

      return rows;
    },
    /**
     * @param source
     * @param version
     * @param assets
     */
    async create(source, version, assets) {
      await tx.sources.createMany({
        data: {
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
        },
      });
      await saveSourceMetadata(tx, source);
      await tx.sourceVersions.createMany({
        data: {
          id: version.id,
          sourceId: version.sourceId,
          ownerId,
          sourceHash: version.sourceHash,
          metadataSnapshot: jsonValue(version.metadataSnapshot),
          capturedAt: version.capturedAt,
          retrievedAt: version.retrievedAt,
          status: version.status,
          textIndexStatus: version.textIndexStatus,
          imageIndexStatus: version.imageIndexStatus,
          activeParseRunId: version.activeParseRunId,
        },
      });
      await saveAssets(tx, ownerId, version.id, assets);
    },
    /**
     * @param version
     * @param expectedSourceRevision
     * @param assets
     */
    async addVersion(version, expectedSourceRevision, assets) {
      const metadata = version.metadataSnapshot;
      const [changed] = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        update sources set
          revision = ${expectedSourceRevision + 1},
          current_version_id = ${version.id}::uuid,
          title = ${metadata.title},
          author_status = ${metadata.authorStatus},
          edition_statement = ${metadata.editionStatement},
          publisher = ${metadata.publisher},
          publication_date_as_printed = ${metadata.publicationDateAsPrinted},
          isbn = ${metadata.isbn},
          canonical_url = ${metadata.canonicalUrl},
          access = ${metadata.access},
          rights_statement = ${metadata.rightsStatement},
          attribution_text = ${metadata.attributionText},
          updated_at = now()
        where id = ${version.sourceId}::uuid and owner_id = ${ownerId}
          and revision = ${expectedSourceRevision}
        returning id
      `);
      if (!changed) {
        return false;
      }
      await tx.sourceContributors.deleteMany({
        where: { sourceId: version.sourceId },
      });
      await tx.sourceLanguages.deleteMany({
        where: { sourceId: version.sourceId },
      });
      await saveSourceMetadata(tx, {
        id: version.sourceId,
        revision: expectedSourceRevision + 1,
        createdAt: version.capturedAt,
        updatedAt: version.capturedAt,
        kind: 'book_pages',
        metadata,
        currentVersionId: version.id,
      });
      await tx.sourceVersions.createMany({
        data: {
          id: version.id,
          sourceId: version.sourceId,
          ownerId,
          sourceHash: version.sourceHash,
          metadataSnapshot: jsonValue(metadata),
          capturedAt: version.capturedAt,
          retrievedAt: version.retrievedAt,
          status: version.status,
          textIndexStatus: version.textIndexStatus,
          imageIndexStatus: version.imageIndexStatus,
          activeParseRunId: version.activeParseRunId,
        },
      });
      await saveAssets(tx, ownerId, version.id, assets);

      return true;
    },
    /**
     * @param version
     * @param expectedStatus
     * @param expectedActiveParseRunId
     */
    async updateVersion(version, expectedStatus, expectedActiveParseRunId) {
      const [changed] = await tx.sourceVersions.updateManyAndReturn({
        data: {
          status: version.status,
          textIndexStatus: version.textIndexStatus,
          imageIndexStatus: version.imageIndexStatus,
          activeParseRunId: version.activeParseRunId,
        },
        where: {
          AND: [
            { id: version.id },
            { ownerId },
            { status: expectedStatus },
            {
              ...(expectedActiveParseRunId === null
                ? { activeParseRunId: null }
                : { activeParseRunId: expectedActiveParseRunId }),
            },
          ],
        },
        select: { id: true },
      });

      return Boolean(changed);
    },
    /** @param pack */
    async saveParsed(pack) {
      const version = await getVersion(pack.sourceVersionId);
      if (!version) {
        throw new Error('Parsed source version is inaccessible');
      }
      await tx.parseRuns.createMany({
        data: {
          id: pack.parseRunId,
          sourceVersionId: pack.sourceVersionId,
          jobId: pack.parseRunId,
          provider: 'application',
          rawOutputAssetId: pack.rawOutputAssetId,
          status: pack.warnings.length ? 'partial' : 'completed',
        },
        skipDuplicates: true,
      });
      await tx.sourceArtifacts.createMany({
        data: {
          assetId: pack.rawOutputAssetId,
          ownerId,
          sourceVersionId: pack.sourceVersionId,
          parseRunId: pack.parseRunId,
          kind: 'raw_parse_output',
        },
        skipDuplicates: true,
      });
      for (const page of pack.pages) {
        const [ownedAsset] = await tx.$queryRaw<
          Array<{ id: mediaAssets['id'] }>
        >(Prisma.sql`
          select media_assets.id as "id"
          from source_version_assets
          join media_assets on (source_version_assets.asset_id = media_assets.id and media_assets.owner_id = ${ownerId})
          where (source_version_assets.version_id = ${pack.sourceVersionId}::uuid and source_version_assets.asset_id = ${page.originalAssetId}::uuid)
        `);
        if (!ownedAsset) {
          throw new Error('Parsed page asset is inaccessible');
        }

        if (page.pdfPageIndex !== null) {
          await tx.canonicalViews.createMany({
            data: {
              id: page.view.id,
              originalAssetId: page.view.originalAssetId,
              derivativeId: null,
              width: page.view.width,
              height: page.view.height,
              coordinateSpace: page.view.originalCoordinateSpace,
              transformToOriginal: jsonValue(page.view.transformToOriginal),
            },
            skipDuplicates: true,
          });
        }
        const view = await tx.canonicalViews.findFirst({
          where: {
            id: page.view.id,
            originalAssetId: page.originalAssetId,
            mediaAssets: { ownerId },
          },
        });
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

        await tx.sourcePages.createMany({
          data: {
            id: page.id,
            sourceVersionId: page.sourceVersionId,
            pageIndex: page.pageIndex,
            printedPageLabel: page.printedPageLabel,
            originalAssetId: page.originalAssetId,
            pdfPageIndex: page.pdfPageIndex,
            canonicalViewId: page.view.id,
          },
          skipDuplicates: true,
        });
        const [storedPage] = await tx.sourcePages.findMany({
          where: { id: page.id },
        });
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
        await tx.sourcePageParses.upsert({
          where: {
            parseRunId_pageId: { parseRunId: pack.parseRunId, pageId: page.id },
          },
          create: {
            parseRunId: pack.parseRunId,
            pageId: page.id,
            rawText: page.rawText,
            searchText: page.searchText,
            quality: page.quality,
          },
          update: {
            rawText: page.rawText,
            searchText: page.searchText,
            quality: page.quality,
          },
        });
      }
      for (const region of pack.regions) {
        await tx.sourceRegions.createMany({
          data: {
            id: region.id,
            sourceVersionId: region.sourceVersionId,
            pageId: region.pageId,
            parseRunId: pack.parseRunId,
            kind: region.kind,
            geometry: jsonValue(region.region),
            rawText: region.rawText,
          },
          skipDuplicates: true,
        });
        const [storedRegion] = await tx.sourceRegions.findMany({
          where: {
            AND: [
              { id: region.id },
              { sourceVersionId: region.sourceVersionId },
              { pageId: region.pageId },
              { parseRunId: pack.parseRunId },
              { kind: region.kind },
              { geometry: { equals: jsonValue(region.region) } },
              {
                ...(region.rawText === null
                  ? { rawText: null }
                  : { rawText: region.rawText }),
              },
            ],
          },
          select: { id: true },
        });
        if (!storedRegion) {
          throw new Error('Parsed region identity conflicts with the original');
        }
      }
      for (const region of pack.regions) {
        if (region.relatedRegionIds.length) {
          await tx.regionRelations.createMany({
            data: region.relatedRegionIds.map((toId) => ({
              fromId: region.id,
              toId,
              kind: 'related',
            })),
            skipDuplicates: true,
          });
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
        const imageData = {
          locatorId: image.id,
          figureRegionId: image.figureRegionId,
          storedDerivativeId: image.storedDerivativeId,
          externalImageUrl: image.externalImageUrl,
          captionText: image.originalCaption?.textAsPrinted,
          captionLocatorId,
          generatedDescriptionZhHant: image.generatedDescriptionZhHant,
          descriptionJobId: image.descriptionJobId,
          captionAssociation: image.captionAssociation,
        };
        await tx.referenceImages.upsert({
          where: { id: image.id },
          create: {
            id: image.id,
            sourceVersionId: image.sourceVersionId,
            ...imageData,
          },
          update: imageData,
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
    /**
     * @param provider
     * @param indexVersion
     * @param providerChunkId
     */
    async resolveProviderChunk(provider, indexVersion, providerChunkId) {
      const row = await tx.sourceChunkMappings.findFirst({
        where: {
          provider,
          indexId: indexVersionId(indexVersion),
          providerChunkId,
          sourceVersions: { ownerId },
        },
      });
      if (!row) {
        return null;
      }
      const regions = await tx.mappingRegions
        .findMany({ where: { mappingId: row.id }, select: { regionId: true } })
        .then((rows) => rows.map((row) => ({ id: row.regionId })));

      return {
        provider: row.provider,
        providerChunkId: row.providerChunkId,
        providerFigureId: row.providerFigureId,
        parseRunId: row.parseRunId,
        indexVersion,
        sourceVersionId: row.sourceVersionId,
        canonicalRegionIds: regions.map((region) => region.id),
      };
    },
    /** @param id */
    async getCitation(id) {
      return readCitation(tx, ownerId, id);
    },
    addCitation,
    /**
     * @param versionId
     * @param entryId
     */
    async linkKnowledgeDraft(versionId, entryId) {
      const version = await getVersion(versionId);
      if (!version) {
        throw new Error('Source version is inaccessible');
      }
      await tx.sourceKnowledgeDrafts.createMany({
        data: { ownerId, sourceVersionId: versionId, entryId },
        skipDuplicates: true,
      });
    },
  };
}
