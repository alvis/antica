import { createHash, randomUUID } from 'node:crypto';

import sharp from 'sharp';

import { validateIndexSpace } from './index-space.js';

import type {
  ImageRetrievalPort,
  IndexIdentity,
  OperationResult,
} from '@antica/application/ports';
import type { ImageMatch } from '@antica/contracts';
import type { Region } from '@antica/domain';

/** identifies a canonical image whose bytes already match the displayed view */
export interface SearchImage {
  readonly originalAssetId: string;
  readonly canonicalViewId: string;
  readonly bytes: Uint8Array;
  readonly region: Region | null;
}

/** joins actual pixels with stable source or collection identity */
export interface ImageSearchEntry {
  readonly image: SearchImage;
  readonly match: Omit<ImageMatch, 'rank'>;
  readonly filterIds: {
    readonly objectTypeIds: readonly string[];
    readonly materialIds: readonly string[];
    readonly periodIds: readonly string[];
    readonly regionIds: readonly string[];
    readonly sourceIds: readonly string[];
  };
}

/** injects authorized images and the persisted descriptor space */
export interface LocalImageRetrievalParams {
  readonly index: IndexIdentity;
  readonly readQuery: (anchorId: string) => Promise<SearchImage>;
  readonly readEntries: () => Promise<readonly ImageSearchEntry[]>;
}

/** records the independent development descriptor version */
export const developmentImageIndex: IndexIdentity = {
  embeddingModelId: 'development:rgb-grid-v1',
  dimensions: 192,
  indexVersion: 'rgb-grid-v1',
};

/**
 * searches actual image content with a labeled development descriptor
 * @param params authorized image readers and index identity
 * @returns retrieval port
 */
export function createLocalImageRetrieval(
  params: LocalImageRetrievalParams,
): ImageRetrievalPort {
  return {
    search: async (query, index) => {
      const compatibility = checkIndex(params.index, index);
      if (!compatibility.success) {
        return compatibility;
      }
      try {
        const original = await params.readQuery(query.queryAnchorId);
        const descriptor = await describeImage(original);
        const wholeDescriptor =
          query.includeWholeImage && original.region
            ? await describeImage({ ...original, region: null })
            : descriptor;
        const entries = (await params.readEntries()).filter(
          (entry) =>
            entry.image.originalAssetId !== original.originalAssetId &&
            (query.scope === 'my_collection'
              ? entry.match.ref.kind === 'collection'
              : entry.match.ref.kind === 'reference') &&
            matchesFilters(entry, query.filters),
        );
        const scored = await Promise.all(
          entries.map(async (entry) => {
            const candidate = await describeImage(entry.image);

            return {
              entry,
              distance: Math.min(
                imageDistance(descriptor, candidate),
                imageDistance(wholeDescriptor, candidate),
              ),
            };
          }),
        );
        scored.sort(
          (left, right) =>
            left.distance - right.distance ||
            matchIdentity(left.entry.match).localeCompare(
              matchIdentity(right.entry.match),
            ),
        );
        const matchesById = new Map<string, Omit<ImageMatch, 'rank'>>();
        for (const item of scored) {
          const key = matchIdentity(item.entry.match);
          const existing = matchesById.get(key);
          matchesById.set(
            key,
            existing
              ? {
                  ...existing,
                  matchingRegions: [
                    ...existing.matchingRegions,
                    ...item.entry.match.matchingRegions,
                  ],
                }
              : item.entry.match,
          );
        }
        const matches = [...matchesById.values()].map(
          (match, position): ImageMatch => ({ ...match, rank: position + 1 }),
        );
        const fingerprint = createHash('sha256')
          .update(JSON.stringify({ ...query, cursor: undefined, index }))
          .digest('hex');
        const offset = query.cursor
          ? parseImageCursor(query.cursor, fingerprint)
          : 0;
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
        const limit = Math.min(query.limit ?? 30, 100);

        return {
          success: true,
          data: {
            queryAnchorId: query.queryAnchorId,
            indexVersion: index.indexVersion,
            availableScope: 'complete',
            warningsZhHant: [
              '開發用 RGB 色彩網格排序，不代表器物、年代或真偽相同。 / Development RGB-grid ranking; not semantic or authenticity evidence.',
            ],
            items: matches.slice(offset, offset + limit),
            nextCursor:
              offset + limit < matches.length
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
            message: 'The selected image could not be decoded for comparison.',
            retryable: false,
          },
          cause,
        };
      }
    },
    compare: async (query, index) => {
      const compatibility = checkIndex(params.index, index);
      if (!compatibility.success) {
        return {
          ...compatibility,
          audit: { invocation: null, rawOutput: null },
        };
      }
      try {
        const original = await params.readQuery(query.queryAnchorId);
        const entries = await params.readEntries();
        const selected = entries.find(
          (entry) =>
            JSON.stringify(entry.match.ref) ===
              JSON.stringify(query.selected) &&
            (!query.selectedCanonicalViewId ||
              entry.image.canonicalViewId === query.selectedCanonicalViewId),
        );
        if (!selected) {
          return {
            success: false,
            audit: { invocation: null, rawOutput: null },
            error: {
              code: 'SOURCE_UNAVAILABLE',
              message:
                'The selected image and region are not available in this index.',
              retryable: false,
            },
          };
        }
        const first = await describeImage(original);
        const second = await describeImage({
          ...selected.image,
          region: query.selectedRegion ?? selected.image.region,
        });
        const distance = imageDistance(first, second);

        return {
          success: true,
          data: {
            invocation: null,
            value: {
              comparisonId: randomUUID(),
              queryAnchorId: query.queryAnchorId,
              selected: query.selected,
              selectedRegion: query.selectedRegion,
              selectedCanonicalViewId: query.selectedCanonicalViewId,
              similaritiesZhHant:
                distance === 0
                  ? [
                      '8×8 RGB 描述相同；僅表示此低解析色彩描述一致。 / The 8×8 RGB descriptors match.',
                    ]
                  : [],
              differencesZhHant:
                distance > 0
                  ? ['8×8 RGB 描述存在差異。 / The 8×8 RGB descriptors differ.']
                  : [],
              limitsZhHant: [
                '開發比較不辨識器形、工藝、年代或真偽；請並排核對原圖。 / Review original images; this descriptor cannot authenticate or date an object.',
              ],
              citations: [],
            },
          },
        };
      } catch (cause) {
        return {
          success: false,
          audit: { invocation: null, rawOutput: null },
          error: {
            code: 'SOURCE_UNAVAILABLE',
            message: 'The selected comparison image could not be decoded.',
            retryable: false,
          },
          cause,
        };
      }
    },
  };
}

/**
 * checks both image indexes against the declared descriptor space
 * @param stored stored image index identity
 * @param query requested query index identity
 * @returns compatibility result
 */
function checkIndex(
  stored: IndexIdentity,
  query: IndexIdentity,
): OperationResult<null> {
  return validateIndexSpace(stored, query).valid &&
    validateIndexSpace(developmentImageIndex, stored).valid
    ? { success: true, data: null }
    : {
        success: false,
        error: {
          code: 'INDEX_NOT_READY',
          message: 'The query and image index use different descriptor spaces.',
          retryable: false,
        },
      };
}

/**
 * computes a bounded RGB descriptor for the selected original image region
 * @param image authorized image bytes and canonical selection
 * @returns actual normalized image descriptor
 */
async function describeImage(image: SearchImage): Promise<Uint8Array> {
  const metadata = await sharp(image.bytes).metadata();
  const width = metadata.width;
  const height = metadata.height;
  if (!width || !height) {
    throw new RangeError('The selected image has no measurable dimensions');
  }
  const region = image.region;
  const bounds =
    region?.kind === 'polygon'
      ? {
          x: Math.min(...region.points.map((point) => point.x)),
          y: Math.min(...region.points.map((point) => point.y)),
          right: Math.max(...region.points.map((point) => point.x)),
          bottom: Math.max(...region.points.map((point) => point.y)),
        }
      : region
        ? {
            x: region.x,
            y: region.y,
            right: region.x + region.width,
            bottom: region.y + region.height,
          }
        : { x: 0, y: 0, right: 1, bottom: 1 };
  if (
    bounds.x < 0 ||
    bounds.y < 0 ||
    bounds.right > 1 ||
    bounds.bottom > 1 ||
    bounds.right <= bounds.x ||
    bounds.bottom <= bounds.y
  ) {
    throw new RangeError('The image selection is outside its canonical view');
  }
  const polygonPoints =
    region?.kind === 'polygon'
      ? region.points
          .map((point) => [point.x * width, point.y * height].join(','))
          .join(' ')
      : '';
  const maskedBytes =
    region?.kind === 'polygon'
      ? await sharp(image.bytes)
          .ensureAlpha()
          .composite([
            {
              input: Buffer.from(
                `<svg width="${width}" height="${height}"><polygon points="${polygonPoints}" fill="white"/></svg>`,
              ),
              blend: 'dest-in',
            },
          ])
          .png()
          .toBuffer()
      : image.bytes;
  const left = Math.floor(bounds.x * width);
  const top = Math.floor(bounds.y * height);

  return sharp(maskedBytes)
    .extract({
      left,
      top,
      width: Math.max(1, Math.ceil(bounds.right * width) - left),
      height: Math.max(1, Math.ceil(bounds.bottom * height) - top),
    })
    .flatten({ background: '#ffffff' })
    .resize(8, 8, { fit: 'fill' })
    .toColourspace('srgb')
    .removeAlpha()
    .raw()
    .toBuffer();
}

/**
 * compares two equal-space RGB descriptors
 * @param first query descriptor
 * @param second candidate descriptor
 * @returns mean absolute channel difference
 */
function imageDistance(first: Uint8Array, second: Uint8Array): number {
  return (
    first.reduce(
      (total, value, position) => total + Math.abs(value - second[position]!),
      0,
    ) / first.length
  );
}

/**
 * groups image matches by their durable original identity
 * @param match canonical image search match
 * @returns stable grouping key
 */
function matchIdentity(match: Omit<ImageMatch, 'rank'>): string {
  return match.ref.kind === 'reference'
    ? `${match.ref.sourceVersionId}:${match.ref.referenceImageId}`
    : match.ref.originalAssetId;
}

/**
 * applies classifications while honoring explicit unknown handling
 * @param entry authorized image entry and classifications
 * @param filters requested classification filters
 * @returns whether the entry matches
 */
function matchesFilters(
  entry: ImageSearchEntry,
  filters: Parameters<ImageRetrievalPort['search']>[0]['filters'],
): boolean {
  return (
    [
      'objectTypeIds',
      'materialIds',
      'periodIds',
      'regionIds',
      'sourceIds',
    ] as const
  ).every((key) => {
    const selected = filters[key];
    const actual = entry.filterIds[key];

    return (
      !selected?.length ||
      actual.some((id) => selected.includes(id)) ||
      (actual.length === 0 && (filters.includeUnknown ?? true))
    );
  });
}

/**
 * validates an image cursor against its query and index
 * @param cursor opaque encoded pagination cursor
 * @param fingerprint expected query fingerprint
 * @returns valid offset or null
 */
function parseImageCursor(cursor: string, fingerprint: string): number | null {
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
