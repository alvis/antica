import { randomUUID } from 'node:crypto';

import { describeImage, imageDistance } from './descriptor.js';

import type { ImageRetrievalPort } from '@antica/application/ports';
import type { ImageCompareRequest } from '@antica/contracts';

import type { LocalImageRetrievalParams } from '../image.js';

/**
 * compares compatible selected pixels with the original audit and failure shape
 * @param params authorized image readers and index identity
 * @param query selected image and canonical region
 * @returns pixel comparison or the original audited failure
 */
export async function compareImages(
  params: LocalImageRetrievalParams,
  query: ImageCompareRequest,
): ReturnType<ImageRetrievalPort['compare']> {
  try {
    const original = await params.readQuery(query.queryAnchorId);
    const entries = await params.readEntries();
    const selected = entries.find(
      (entry) =>
        JSON.stringify(entry.match.ref) === JSON.stringify(query.selected) &&
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

    return createComparison(query, distance);
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
}

/**
 * creates the labeled comparison result after both descriptors are measured
 * @param query selected image and canonical region
 * @param distance measured mean channel difference
 * @returns the original successful comparison envelope
 */
function createComparison(
  query: ImageCompareRequest,
  distance: number,
): Awaited<ReturnType<ImageRetrievalPort['compare']>> {
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
}
