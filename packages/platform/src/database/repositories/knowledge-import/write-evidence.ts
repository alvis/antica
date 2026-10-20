import { canonicalJson, projectionId } from '../knowledge/canonical.js';

import { insertRows } from './rows.js';

import type { ImportWriteContext } from './write.js';

const maximumLocatorExcerptLength = 24_000;

/**
 * creates owner-private sources for newly discovered provider identities
 * @param context measured writer and prevalidated batch projections
 */
export async function writeSources(context: ImportWriteContext): Promise<void> {
  const { writer, now, ownerId, newObjects } = context;
  await insertRows(
    writer,
    'sources',
    newObjects.map((object) => ({
      id: object.sourceId,
      ownerId,
      kind: 'structured_open_data',
      revision: 1,
      title: object.source.title,
      authorStatus: object.source.contributors.length ? 'named' : 'unknown',
      canonicalUrl: object.snapshot.sourcePageUrl,
      access: 'link_only',
      createdAt: now,
      updatedAt: now,
    })),
  );
}

/**
 * creates stable provider identities without replacing existing import history
 * @param context measured writer and prevalidated batch projections
 */
export async function writeExternalObjects(
  context: ImportWriteContext,
): Promise<void> {
  const { writer, now, ownerId, newObjects } = context;
  await insertRows(
    writer,
    'external_objects',
    newObjects.map((object) => ({
      id: object.externalId,
      ownerId,
      sourceId: object.sourceId,
      provider: object.snapshot.provider,
      objectId: object.objectId,
      canonicalRecordUrl: object.snapshot.sourcePageUrl,
      upstreamModifiedAt: object.external.upstreamModifiedAt ?? null,
      lastSeenAt: now,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    })),
  );
}

/**
 * pins complete payloads and bibliography to each captured hash
 * @param context measured writer and prevalidated batch projections
 */
export async function writeSourceVersions(
  context: ImportWriteContext,
): Promise<void> {
  const { writer, ownerId, captured } = context;
  await insertRows(
    writer,
    'source_versions',
    captured.map((object) => ({
      id: object.versionId,
      sourceId: object.sourceId,
      ownerId,
      externalObjectId: object.externalId,
      sourceHash: object.snapshot.sourceHash,
      metadataSnapshot: {
        title: object.source.title,
        canonicalUrl: object.source.canonicalUrl,
        languages: object.source.languages,
        contributors: object.source.contributors.map((nameAsPrinted) => ({
          nameAsPrinted,
          role: 'institution',
          attribution: 'as_printed',
        })),
        authorStatus: object.source.contributors.length ? 'named' : 'unknown',
        editionStatement: null,
        publisher: null,
        publicationDateAsPrinted: null,
        isbn: null,
        access: 'link_only',
        rightsStatement: null,
        attributionText: null,
      },
      capturedAt: object.snapshot.retrievedAt,
      retrievedAt: object.snapshot.retrievedAt,
      status: 'ready',
      textIndexStatus: 'ready',
      imageIndexStatus: 'ready',
      providerSchemaVersion: object.snapshot.schemaVersion,
      payloadHash: object.snapshot.payloadHash,
      structuredPayload: object.snapshot.payload,
      observedRights: object.snapshot.observedRights ?? null,
    })),
  );
}

/**
 * deduplicates captured locators while retaining a payload root for image references
 * @param context measured writer and prevalidated batch projections
 */
export async function writeLocators(
  context: ImportWriteContext,
): Promise<void> {
  const { writer, captured } = context;
  const locators = captured.flatMap((object) => {
    const supplied = object.content.citations.map((citation) => ({
      id: citation.locator.id,
      sourceId: object.sourceId,
      sourceVersionId: object.versionId,
      kind: citation.locator.kind,
      url: object.snapshot.sourcePageUrl,
      retrievedAt: object.snapshot.retrievedAt,
      excerptAsRetrieved: citation.locator.excerpt,
      provider:
        citation.locator.kind === 'structured'
          ? citation.locator.provider
          : null,
      objectId:
        citation.locator.kind === 'structured'
          ? citation.locator.objectId
          : null,
      fieldPath:
        citation.locator.kind === 'structured'
          ? citation.locator.fieldPath
          : null,
      valueHash:
        citation.locator.kind === 'structured'
          ? citation.locator.valueHash
          : null,
    }));

    const rootId = projectionId(
      `${object.versionId}:field::${object.snapshot.payloadHash}`,
    );
    if (supplied.some((locator) => locator.id === rootId)) {
      return supplied;
    }

    return [
      ...supplied,
      {
        id: rootId,
        sourceId: object.sourceId,
        sourceVersionId: object.versionId,
        kind: 'structured',
        url: object.snapshot.sourcePageUrl,
        retrievedAt: object.snapshot.retrievedAt,
        excerptAsRetrieved: canonicalJson(object.snapshot.payload).slice(
          0,
          maximumLocatorExcerptLength,
        ),
        provider: object.snapshot.provider,
        objectId: object.objectId,
        fieldPath: '',
        valueHash: object.snapshot.payloadHash,
      },
    ];
  });
  await insertRows(writer, 'source_locators', [
    ...new Map(locators.map((locator) => [locator.id, locator])).values(),
  ]);
}
