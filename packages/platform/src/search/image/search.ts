import { createHash } from 'node:crypto';

import { describeImage, imageDistance } from './descriptor.js';
import { matchesFilters, rankImageMatches } from './matches.js';

import type {
  ImageRetrievalPort,
  IndexIdentity,
  OperationResult,
} from '@antica/application/ports';
import type {
  ImageMatch,
  ImageSearchRequest,
  ImageSearchResult,
} from '@antica/contracts';

import type { ImageSearchEntry, LocalImageRetrievalParams } from '../image.js';

import type { ScoredImageMatch } from './matches.js';

/** supplies the ranked matches and their original query to pagination */
interface ImagePageParams {
  readonly matches: readonly ImageMatch[];
  readonly query: ImageSearchRequest;
  readonly index: IndexIdentity;
}

const DEFAULT_PAGE_SIZE = 30;
const MAX_PAGE_SIZE = 100;

/**
 * searches compatible canonical pixels with the original failure envelope
 * @param params authorized image readers and index identity
 * @param query requested image search
 * @param index requested descriptor space
 * @returns ranked image page or the original typed failure
 */
export async function searchImages(
  params: LocalImageRetrievalParams,
  query: ImageSearchRequest,
  index: IndexIdentity,
): ReturnType<ImageRetrievalPort['search']> {
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
    const scored = await scoreImages(entries, descriptor, wholeDescriptor);
    const matches = rankImageMatches(scored);

    return createImagePage({ matches, query, index });
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
}

/**
 * scores canonical candidates concurrently against region and whole descriptors
 * @param entries authorized candidates
 * @param descriptor selected query descriptor
 * @param wholeDescriptor whole-image query descriptor
 * @returns measured candidate distances in input order
 */
async function scoreImages(
  entries: readonly ImageSearchEntry[],
  descriptor: Uint8Array,
  wholeDescriptor: Uint8Array,
): Promise<ScoredImageMatch[]> {
  return Promise.all(
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
}

/**
 * applies query-bound cursor validation and the original page limits
 * @param params ranked candidates and query identity
 * @returns requested page or an invalid-cursor failure
 */
function createImagePage(
  params: ImagePageParams,
): OperationResult<ImageSearchResult> {
  const { matches, query, index } = params;
  const fingerprint = createHash('sha256')
    .update(JSON.stringify({ ...query, cursor: undefined, index }))
    .digest('hex');
  const offset = query.cursor ? parseImageCursor(query.cursor, fingerprint) : 0;
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
  const limit = Math.min(query.limit ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);

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
