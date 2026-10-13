import { validateIndexSpace } from './index-space.js';
import { QdrantClient } from '@qdrant/js-client-rest';
import { createHash } from 'node:crypto';

import type { ImageSearchEntry, SearchImage } from './image.js';
import type { VoyageImageEmbedding } from './voyage.js';

type SuccessfulImageEmbedding = Extract<
  Awaited<ReturnType<VoyageImageEmbedding['embed']>>,
  { readonly success: true }
>;
import type {
  ImageRetrievalPort,
  IndexIdentity,
  OperationResult,
} from '@antica/application/ports';
import type { ImageMatch, ImageSearchRequest } from '@antica/contracts';

/** binds a physical collection to its persisted model manifest and tenant */
export interface QdrantImageRetrievalParams {
  readonly url: string;
  readonly apiKey?: string;
  readonly collection: string;
  readonly ownerId: string;
  readonly corpusId: string;
  readonly index: IndexIdentity;
  readonly embedding: VoyageImageEmbedding;
  readonly readQuery: (anchorId: string) => Promise<SearchImage>;
  /** resolves only records authorized for this owner and corpus, never provider payload locators */
  readonly resolveEntry: (pointId: string) => Promise<ImageSearchEntry | null>;
  readonly compare: ImageRetrievalPort['compare'];
  readonly queryPoints?: QdrantClient['query'];
  readonly readCollection?: QdrantClient['getCollection'];
}

/** supplies one application-owned immutable image identifier for ingestion */
export interface QdrantImageDocument {
  readonly pointId: string;
  readonly entry: ImageSearchEntry;
}

/** exposes explicit ingestion without creating or replacing a collection */
export interface QdrantImageWriter {
  upsert(document: QdrantImageDocument): Promise<OperationResult<null>>;
}

/**
 * queries an isolated image collection and resolves canonical application locators
 * @param params provider connection and authorized application capabilities
 * @returns executable image retrieval port
 */
export function createQdrantImageRetrieval(
  params: QdrantImageRetrievalParams,
): ImageRetrievalPort {
  const client = new QdrantClient({
    url: params.url,
    apiKey: params.apiKey,
    timeout: 30_000,
    checkCompatibility: false,
  });
  const queryPoints = params.queryPoints ?? client.query.bind(client);
  const readCollection =
    params.readCollection ?? client.getCollection.bind(client);

  return {
    compare: async (query, index) =>
      validateIndexSpace(params.index, index).valid
        ? params.compare(query, index)
        : {
            success: false,
            audit: { invocation: null, rawOutput: null },
            error: {
              code: 'INDEX_NOT_READY',
              message: 'The comparison index is incompatible.',
              retryable: false,
            },
          },
    search: async (query, index) => {
      if (
        !validateIndexSpace(params.index, index).valid ||
        !validateIndexSpace(params.embedding.index, index).valid ||
        !params.ownerId ||
        !params.corpusId
      ) {
        return {
          success: false,
          error: {
            code: 'INDEX_NOT_READY',
            message: 'The image index manifest is incompatible or unscoped.',
            retryable: false,
          },
        };
      }
      const fingerprint = createHash('sha256')
        .update(
          JSON.stringify({
            ...query,
            cursor: undefined,
            index,
            ownerId: params.ownerId,
            corpusId: params.corpusId,
          }),
        )
        .digest('hex');
      const offset = query.cursor ? readOffset(query.cursor, fingerprint) : 0;
      if (offset === null) {
        return {
          success: false,
          error: {
            code: 'VALIDATION_FAILED',
            message: 'The image cursor belongs to another query.',
            retryable: false,
          },
        };
      }
      try {
        const collection = await readCollection(params.collection);
        const vectors = collection.config.params.vectors;
        if (
          !vectors ||
          !('size' in vectors) ||
          vectors.size !== index.dimensions ||
          vectors.distance !== 'Cosine'
        ) {
          return {
            success: false,
            error: {
              code: 'INDEX_NOT_READY',
              message:
                'The Qdrant collection dimensions or distance are incompatible.',
              retryable: false,
            },
          };
        }
        const original = await params.readQuery(query.queryAnchorId);
        const images =
          query.includeWholeImage && original.region
            ? [original, { ...original, region: null }]
            : [original];
        const embeddings = await Promise.all(
          images.map(async (image) => params.embedding.embed(image, 'query')),
        );
        const failure = embeddings.find((result) => !result.success);
        if (failure) {
          return failure;
        }
        const successfulEmbeddings = embeddings as SuccessfulImageEmbedding[];
        const results = await Promise.all(
          successfulEmbeddings.map(async (result) =>
            queryPoints(params.collection, {
              query: result.data,
              filter: {
                must: [
                  { key: 'ownerId', match: { value: params.ownerId } },
                  { key: 'corpusId', match: { value: params.corpusId } },
                  {
                    key: 'indexVersion',
                    match: { value: index.indexVersion },
                  },
                  {
                    key: 'embeddingModelId',
                    match: { value: index.embeddingModelId },
                  },
                  {
                    key: 'dimensions',
                    match: { value: index.dimensions },
                  },
                  { key: 'scope', match: { value: query.scope } },
                ],
                must_not: [
                  {
                    key: 'originalAssetId',
                    match: { value: original.originalAssetId },
                  },
                ],
              },
              limit: 1000,
              with_payload: false,
              with_vector: false,
            }),
          ),
        );
        const points = results
          .flatMap((result) => result.points)
          .sort(
            (left, right) =>
              right.score - left.score ||
              String(left.id).localeCompare(String(right.id)),
          );
        const uniquePoints = [
          ...new Map(points.map((point) => [String(point.id), point])).values(),
        ];
        const entries = await Promise.all(
          uniquePoints.map(async (point) =>
            params.resolveEntry(String(point.id)),
          ),
        );
        const matches = new Map<string, Omit<ImageMatch, 'rank'>>();
        for (const entry of entries) {
          if (
            !entry ||
            entry.image.originalAssetId === original.originalAssetId ||
            (query.scope === 'my_collection') !==
              (entry.match.ref.kind === 'collection') ||
            !matchesFilters(entry, query)
          ) {
            continue;
          }
          const ref = entry.match.ref;
          const key =
            ref.kind === 'collection'
              ? ref.originalAssetId
              : `${ref.sourceVersionId}:${ref.referenceImageId}`;
          const previous = matches.get(key);
          matches.set(
            key,
            previous
              ? {
                  ...previous,
                  matchingRegions: [
                    ...previous.matchingRegions,
                    ...entry.match.matchingRegions,
                  ],
                }
              : entry.match,
          );
        }
        const ordered = [...matches.values()].map(
          (match, rank): ImageMatch => ({ ...match, rank: rank + 1 }),
        );
        const limit = query.limit ?? 30;
        const partial =
          results.some((result) => result.points.length === 1000) ||
          entries.some((entry) => entry === null);

        return {
          success: true,
          data: {
            queryAnchorId: query.queryAnchorId,
            indexVersion: index.indexVersion,
            availableScope: partial ? 'partial' : 'complete',
            warningsZhHant: partial
              ? [
                  '每張影像最多檢索 1,000 個候選向量；無法存取的原始紀錄及較低排名結果可能未列出。 / Retrieval is capped at 1,000 vectors per image; unavailable records and lower-ranked matches may be omitted.',
                ]
              : [],
            items: ordered.slice(offset, offset + limit),
            nextCursor:
              offset + limit < ordered.length
                ? Buffer.from(
                    JSON.stringify({ offset: offset + limit, fingerprint }),
                  ).toString('base64url')
                : null,
          },
        };
      } catch (cause) {
        return {
          success: false,
          error: {
            code: 'SOURCE_UNAVAILABLE',
            message: 'The image retrieval provider is unavailable.',
            retryable: true,
          },
          cause,
        };
      }
    },
  };
}

/**
 * indexes document pixels with explicit tenant and embedding-space metadata
 * @param params configured provider and authorized corpus manifest
 * @returns document ingestion capability
 */
export function createQdrantImageWriter(
  params: QdrantImageRetrievalParams,
): QdrantImageWriter {
  const client = new QdrantClient({
    url: params.url,
    apiKey: params.apiKey,
    timeout: 30_000,
    checkCompatibility: false,
  });

  return {
    upsert: async (document) => {
      if (
        !params.ownerId ||
        !params.corpusId ||
        !validateIndexSpace(params.index, params.embedding.index).valid
      ) {
        return {
          success: false,
          error: {
            code: 'INDEX_NOT_READY',
            message:
              'The image ingestion manifest is incompatible or unscoped.',
            retryable: false,
          },
        };
      }
      const embedding = await params.embedding.embed(
        document.entry.image,
        'document',
      );
      if (!embedding.success) {
        return embedding;
      }
      try {
        const collection = await client.getCollection(params.collection);
        const vectors = collection.config.params.vectors;
        if (
          !vectors ||
          !('size' in vectors) ||
          vectors.size !== params.index.dimensions ||
          vectors.distance !== 'Cosine'
        ) {
          return {
            success: false,
            error: {
              code: 'INDEX_NOT_READY',
              message:
                'The Qdrant write target has incompatible dimensions or distance.',
              retryable: false,
            },
          };
        }
        await client.upsert(params.collection, {
          wait: true,
          points: [
            {
              id: document.pointId,
              vector: embedding.data,
              payload: {
                ownerId: params.ownerId,
                corpusId: params.corpusId,
                ...params.index,
                scope:
                  document.entry.match.ref.kind === 'collection'
                    ? 'my_collection'
                    : 'reference_library',
                originalAssetId: document.entry.image.originalAssetId,
              },
            },
          ],
        });

        return { success: true, data: null };
      } catch (cause) {
        return {
          success: false,
          error: {
            code: 'SOURCE_UNAVAILABLE',
            message: 'The image index write failed.',
            retryable: true,
          },
          cause,
        };
      }
    },
  };
}

/**
 * decodes a query-bound pagination offset
 * @param cursor encoded pagination state
 * @param fingerprint expected query identity
 * @returns offset or null for an incompatible cursor
 */
function readOffset(cursor: string, fingerprint: string): number | null {
  try {
    const value: unknown = JSON.parse(
      Buffer.from(cursor, 'base64url').toString('utf8'),
    );
    if (
      typeof value !== 'object' ||
      value === null ||
      !('fingerprint' in value) ||
      value.fingerprint !== fingerprint ||
      !('offset' in value) ||
      typeof value.offset !== 'number' ||
      !Number.isSafeInteger(value.offset) ||
      value.offset < 0
    ) {
      return null;
    }

    return value.offset;
  } catch {
    return null;
  }
}

/**
 * matches explicit catalog filters against canonical metadata
 * @param entry authorized canonical entry
 * @param query requested filters
 * @returns whether all selected filters match
 */
function matchesFilters(
  entry: ImageSearchEntry,
  query: ImageSearchRequest,
): boolean {
  return (
    [
      'objectTypeIds',
      'materialIds',
      'periodIds',
      'regionIds',
      'sourceIds',
    ] as const
  ).every(
    (key) =>
      !query.filters[key]?.length ||
      entry.filterIds[key].some((id) => query.filters[key]?.includes(id)) ||
      (entry.filterIds[key].length === 0 &&
        (query.filters.includeUnknown ?? true)),
  );
}
