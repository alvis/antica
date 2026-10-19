import { readRecord } from './evidence.js';

import type { CanonicalJson } from '@antica/contracts';

/** captures each remote image URL with its exact source field */
export interface MetImage {
  readonly url: string;
  readonly fieldPath: string;
}

/**
 * retains every distinct primary, small and additional image without fetching bytes
 * @param data complete captured object response
 * @returns image metadata with RFC 6901 pointers
 */
export function collectImages(data: CanonicalJson): MetImage[] {
  const record = readRecord(data);
  const candidates = [
    { value: record.primaryImage, fieldPath: '/primaryImage' },
    { value: record.primaryImageSmall, fieldPath: '/primaryImageSmall' },
    ...(Array.isArray(record.additionalImages)
      ? record.additionalImages
      : []
    ).map((value, index) => ({
      value,
      fieldPath: `/additionalImages/${index}`,
    })),
  ];
  const images = candidates.flatMap(({ value, fieldPath }) =>
    typeof value === 'string' && /^https?:\/\//.test(value)
      ? [{ url: value, fieldPath }]
      : [],
  );

  return [...new Map(images.map((image) => [image.url, image])).values()];
}
