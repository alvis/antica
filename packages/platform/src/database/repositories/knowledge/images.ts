import { canonicalJson } from './canonical.js';
import { KnowledgeReferenceError } from './reference-error.js';

import type { KnowledgeContentEnvelopeV2 } from '@antica/contracts';

import type { KnowledgeContext } from './v2.js';

/**
 * verifies owner scope and immutable metadata for every pinned remote image
 * @param context transaction and required owner
 * @param requested remote images captured in the immutable envelope
 */
export async function validateImages(
  context: KnowledgeContext,
  requested: KnowledgeContentEnvelopeV2['images'],
): Promise<void> {
  const { tx, ownerId } = context;
  const images = await tx.referenceImages.findMany({
    where: {
      id: { in: requested.map((image) => image.id) },
      sourceVersions: { ownerId },
      source_locators_reference_images_locator_idTosource_locators: {
        sources: { ownerId },
        sourceVersions: { ownerId },
      },
    },
  });
  if (images.length !== requested.length) {
    throw new KnowledgeReferenceError('Knowledge image is inaccessible');
  }
  for (const image of requested) {
    const row = images.find((item) => item.id === image.id)!;
    const expected = {
      sourceVersionId: image.sourceVersionId,
      imageUrl: image.imageUrl,
      sourcePageUrl: image.sourcePageUrl,
      provider: image.provider,
      providerImageId: image.providerImageId ?? null,
      width: image.width ?? null,
      height: image.height ?? null,
      locatorId: image.locatorId ?? row.locatorId,
      observedRights: image.observedRights ?? null,
      storedDerivativeId: null,
    };
    const actual = {
      sourceVersionId: row.sourceVersionId,
      imageUrl: row.externalImageUrl,
      sourcePageUrl: row.sourcePageUrl,
      provider: row.provider,
      providerImageId: row.providerImageId,
      width: row.width,
      height: row.height,
      locatorId: row.locatorId,
      observedRights: row.observedRights,
      storedDerivativeId: row.storedDerivativeId,
    };
    if (canonicalJson(expected) !== canonicalJson(actual)) {
      throw new KnowledgeReferenceError(
        'Knowledge image metadata differs from its pinned source',
      );
    }
  }
}
