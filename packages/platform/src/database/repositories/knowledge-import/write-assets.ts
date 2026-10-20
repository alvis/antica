import { canonicalHash, projectionId } from '../knowledge/canonical.js';

import { insertRows } from './rows.js';

import type { ImportWriteContext } from './write.js';

/**
 * preserves pinned citation relation and verification in one bulk insert
 * @param context measured writer and prevalidated batch projections
 */
export async function writeCitations(
  context: ImportWriteContext,
): Promise<void> {
  const { writer, captured } = context;
  await insertRows(
    writer,
    'citations',
    captured.flatMap((object) =>
      object.content.citations.map((citation) => ({
        id: citation.id,
        locatorId: citation.locator.id,
        relation: citation.relation,
        availability: citation.availability,
        verification: citation.verification,
      })),
    ),
  );
}

/**
 * retains every distinct remote image URL without fetching image bytes
 * @param context measured writer and prevalidated batch projections
 */
export async function writeReferenceImages(
  context: ImportWriteContext,
): Promise<void> {
  const { writer, captured } = context;
  await insertRows(
    writer,
    'reference_images',
    captured.flatMap((object) =>
      object.content.images.map((image) => ({
        id: image.id,
        sourceVersionId: object.versionId,
        locatorId:
          image.locatorId ??
          projectionId(
            `${object.versionId}:field::${object.snapshot.payloadHash}`,
          ),
        externalImageUrl: image.imageUrl,
        captionAssociation: 'none',
        provider: image.provider,
        providerImageId: image.providerImageId ?? null,
        sourcePageUrl: image.sourcePageUrl,
        width: image.width ?? null,
        height: image.height ?? null,
        observedRights: image.observedRights ?? null,
        lastCheckedAt: image.lastCheckedAt ?? null,
        status: image.status,
        remoteUrlHash: canonicalHash(image.imageUrl),
      })),
    ),
  );
}

/**
 * initializes working draft heads while leaving saved pointers empty
 * @param context measured writer and prevalidated batch projections
 */
export async function writeKnowledgeEntries(
  context: ImportWriteContext,
): Promise<void> {
  const { writer, prepared, now, ownerId } = context;
  await insertRows(
    writer,
    'knowledge_entries',
    prepared
      .filter((object) => !object.prior?.entryId)
      .map((object) => ({
        id: object.entryId,
        ownerId,
        displayCode: `IMP-${object.entryId}`,
        contentId: object.contentId,
        currentRevision: 1,
        createdAt: now,
        updatedAt: now,
      })),
  );
}
