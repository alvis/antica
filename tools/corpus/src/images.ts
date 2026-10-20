import type { CanonicalJson } from '@antica/contracts';

const previousFieldOffset = -2;

/**
 * Collects all captured image URLs and AIC image services, without network I/O.
 * @param payload complete provider snapshot, including wrapped responses
 * @returns distinct original URLs, preserving query strings
 */
export function discoverImageUrls(payload: CanonicalJson): Set<string> {
  const urls = new Set<string>();
  visitImages(payload, [], urls);

  return urls;
}

/**
 * Walks generic image fields, Cleveland variants, Met views and IIIF resources.
 * @param value current captured node
 * @param path enclosing field names
 * @param urls accumulated URL set
 */
function visitImages(
  value: CanonicalJson,
  path: readonly string[],
  urls: Set<string>,
): void {
  if (typeof value === 'string' && /^https?:\/\//.test(value)) {
    const imageKey =
      /^(?:images?|alternate_images|additionalImages|primaryImage\w*|image_?url|image_url_\w+|thumbnail\w*|\w+ImageUrl)$/i;
    const key = path.at(-1) ?? '';
    const imageField =
      imageKey.test(key) ||
      (/^\d+$/.test(key) &&
        imageKey.test(path.at(previousFieldOffset) ?? '')) ||
      (key === 'url' && path.some((part) => imageKey.test(part))) ||
      (path.includes('images') && !['@context', 'profile'].includes(key));
    const imageUrl =
      /\.(?:jpe?g|png|gif|webp|tiff?|jp2|avif|svg)(?:[?#]|$)/i.test(value);
    const iiifImage =
      /\/iiif\//i.test(value) &&
      !/\/iiif\/(?:[23]\/?)?$/i.test(value) &&
      !/\.json(?:[?#]|$)/i.test(value);
    if (imageField || imageUrl || iiifImage) {
      urls.add(value);
    }
  }
  if (value === null || typeof value !== 'object') {
    return;
  }
  if (!Array.isArray(value)) {
    collectAicServices(value as Readonly<Record<string, CanonicalJson>>, urls);
  }
  for (const [key, item] of Object.entries(
    value as Readonly<Record<string, CanonicalJson>>,
  )) {
    visitImages(item, [...path, key], urls);
  }
}

/**
 * Expands AIC primary and alternate image identifiers against their IIIF base.
 * @param response provider response containing data and config
 * @param urls accumulated URL set
 */
function collectAicServices(
  response: Readonly<Record<string, CanonicalJson>>,
  urls: Set<string>,
): void {
  const config = response.config;
  const data = response.data;
  if (
    config === null ||
    typeof config !== 'object' ||
    !('iiif_url' in config) ||
    typeof config.iiif_url !== 'string' ||
    !/^https?:\/\//.test(config.iiif_url)
  ) {
    return;
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    return;
  }
  const record = data as Readonly<Record<string, CanonicalJson>>;
  const identifiers = [
    record.image_id,
    ...(Array.isArray(record.alt_image_ids) ? record.alt_image_ids : []),
  ];
  for (const id of identifiers) {
    if (typeof id === 'string' && id.length > 0) {
      urls.add(`${config.iiif_url.replace(/\/$/, '')}/${id}`);
    }
  }
}
