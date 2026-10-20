import { createHash } from 'node:crypto';

import { canonicalHash, canonicalJson } from './canonical.js';
import { validateImages } from './images.js';
import { KnowledgeReferenceError } from './reference-error.js';

import type { KnowledgeContentEnvelopeV2 } from '@antica/contracts';

import type { Prisma } from '../../generated/client.js';
import type { Transaction } from '../../transaction.js';

export { KnowledgeReferenceError } from './reference-error.js';

interface ReferenceContext {
  readonly tx: Transaction;
  readonly ownerId: string;
}
type Citation = KnowledgeContentEnvelopeV2['citations'][number];
type LocatorRow = Prisma.sourceLocatorsGetPayload<{
  include: {
    sourceVersions: { include: { externalObject: true } };
    sourceRegions: true;
    sourceBlocks: true;
  };
}>;

/**
 * resolves an RFC6901 pointer without accepting inherited object properties
 * @param payload captured canonical provider metadata
 * @param pointer validated RFC6901 pointer
 * @returns the captured value or undefined when the pointer does not resolve
 */
export function resolvePointer(payload: unknown, pointer: string): unknown {
  let value = payload;
  for (const token of pointer === '' ? [] : pointer.slice(1).split('/')) {
    const key = token.replaceAll('~1', '/').replaceAll('~0', '~');
    if (
      value === null ||
      typeof value !== 'object' ||
      !Object.hasOwn(value, key)
    ) {
      return undefined;
    }
    value = (value as Record<string, unknown>)[key];
  }

  return value;
}

/**
 * compares submitted locations and quotes with immutable stored evidence
 * @param row persisted locator and captured evidence version
 * @param citation submitted pinned citation
 * @returns whether the locator and quotation agree with captured evidence
 */
function matchesLocator(row: LocatorRow, citation: Citation): boolean {
  const locator = citation.locator;
  if (row.kind !== locator.kind || !locator.excerpt.includes(citation.quote)) {
    return false;
  }
  if (locator.kind === 'page') {
    const text =
      row.excerptAsRetrieved ??
      row.sourceRegions?.rawText ??
      row.sourceBlocks?.rawText;

    return (
      row.pageId === locator.pageId &&
      row.pageIndex === locator.pageIndex &&
      row.printedPageLabel === locator.printedPageLabel &&
      typeof text === 'string' &&
      text.includes(locator.excerpt)
    );
  }
  if (
    row.url !== locator.url ||
    row.retrievedAt?.toISOString() !== locator.retrievedAt ||
    row.excerptAsRetrieved !== locator.excerpt
  ) {
    return false;
  }
  if (locator.kind === 'web') {
    return locator.section === undefined || locator.section === row.blockId;
  }

  return matchesStructured(row, locator);
}

/**
 * validates a captured structured field against its immutable payload
 * @param row stored locator and payload
 * @param locator submitted structured field location
 * @returns whether the captured pointer, hash and excerpt are exact
 */
function matchesStructured(
  row: LocatorRow,
  locator: Extract<Citation['locator'], { kind: 'structured' }>,
): boolean {
  const version = row.sourceVersions;
  const metadata = version.metadataSnapshot as { canonicalUrl?: string };
  const value = resolvePointer(version.structuredPayload, locator.fieldPath);

  return (
    version.externalObject?.provider === locator.provider &&
    version.externalObject.objectId === locator.objectId &&
    metadata.canonicalUrl === locator.url &&
    version.retrievedAt?.toISOString() === locator.retrievedAt &&
    value !== undefined &&
    canonicalHash(value) === locator.valueHash &&
    (typeof value === 'string' ? value : canonicalJson(value)).includes(
      locator.excerpt,
    ) &&
    row.provider === locator.provider &&
    row.objectId === locator.objectId &&
    row.fieldPath === locator.fieldPath &&
    row.valueHash === locator.valueHash
  );
}

/**
 * validates a pinned citation through the locator, version and source owner chain
 * @param context transaction and required owner
 * @param citation immutable evidence metadata submitted by the editor
 */
export async function validateCitation(
  context: ReferenceContext,
  citation: Citation,
): Promise<void> {
  const { tx, ownerId } = context;
  const row = await tx.citations.findFirst({
    where: {
      id: citation.id,
      sourceLocators: {
        id: citation.locator.id,
        sourceId: citation.source.id,
        sourceVersionId: citation.source.versionId,
        sources: { ownerId },
        sourceVersions: { ownerId, sourceId: citation.source.id },
      },
    },
    include: {
      sourceLocators: {
        include: {
          sourceVersions: { include: { externalObject: true } },
          sourceRegions: true,
          sourceBlocks: true,
        },
      },
    },
  });
  if (
    !row ||
    citation.locator.sourceId !== citation.source.id ||
    citation.locator.sourceVersionId !== citation.source.versionId ||
    row.relation !== citation.relation ||
    row.verification !== citation.verification ||
    row.availability !== citation.availability ||
    !matchesLocator(row.sourceLocators, citation)
  ) {
    throw new KnowledgeReferenceError(
      'Knowledge citation is inaccessible or differs from its pinned locator',
    );
  }
  validateSourceMetadata(row.sourceLocators, citation);
}

/**
 * compares bibliography and structured snapshots with captured version metadata
 * @param locator stored locator with its exact version
 * @param citation submitted pinned source metadata
 */
function validateSourceMetadata(locator: LocatorRow, citation: Citation): void {
  const version = locator.sourceVersions;
  const metadata = version.metadataSnapshot as {
    title?: string;
    canonicalUrl?: string;
    languages?: string[];
    contributors?: Array<{ nameAsPrinted: string }>;
  };
  if (
    metadata.title !== citation.source.title ||
    canonicalJson(metadata.languages) !==
      canonicalJson(citation.source.languages) ||
    canonicalJson(metadata.contributors?.map((item) => item.nameAsPrinted)) !==
      canonicalJson(citation.source.contributors) ||
    (citation.source.canonicalUrl !== undefined &&
      metadata.canonicalUrl !== citation.source.canonicalUrl)
  ) {
    throw new KnowledgeReferenceError(
      'Knowledge source metadata differs from its pinned snapshot',
    );
  }
  const snapshot = citation.source.structuredSnapshot;
  if (
    snapshot &&
    (canonicalHash(snapshot.payload) !== version.payloadHash ||
      snapshot.payloadHash !== version.payloadHash ||
      canonicalHash({
        provider: snapshot.provider,
        objectId: snapshot.objectId,
        payloadHash: snapshot.payloadHash,
        schemaVersion: snapshot.schemaVersion,
      }) !== version.sourceHash ||
      snapshot.sourcePageUrl !== metadata.canonicalUrl ||
      snapshot.retrievedAt !== version.retrievedAt?.toISOString() ||
      canonicalJson(snapshot.observedRights ?? null) !==
        canonicalJson(version.observedRights) ||
      snapshot.sourceHash !== version.sourceHash ||
      snapshot.schemaVersion !== version.providerSchemaVersion ||
      canonicalJson(snapshot.payload) !==
        canonicalJson(version.structuredPayload))
  ) {
    throw new KnowledgeReferenceError(
      'Structured source metadata differs from its pinned snapshot',
    );
  }
}

/**
 * rejects stale reviewed translations and forged original variants
 * @param content complete validated content envelope
 */
function validateVariants(content: KnowledgeContentEnvelopeV2): void {
  for (const claim of content.claims) {
    const textHash = createHash('sha256')
      .update(claim.originalText)
      .digest('hex');
    if (
      claim.variants.some(
        (variant) =>
          variant.sourceTextHash !== textHash &&
          (variant.kind === 'original' || variant.review.state !== 'pending'),
      )
    ) {
      throw new KnowledgeReferenceError(
        'Language variant does not match its original claim',
      );
    }
  }
}

/**
 * validates ownership and pinned identity of method versions and reference links
 * @param context transaction and required owner
 * @param content complete validated content envelope
 */
async function validateLinks(
  context: ReferenceContext,
  content: KnowledgeContentEnvelopeV2,
): Promise<void> {
  const { tx, ownerId } = context;
  const ids = content.methodVersionIds ?? [];
  const versions = await tx.methodVersions.findMany({
    where: {
      id: { in: ids },
      inspectionMethods: { knowledgeEntries: { ownerId } },
    },
  });
  if (
    versions.length !== new Set(ids).size ||
    versions.some((version) => !content.methodIds.includes(version.methodId))
  ) {
    throw new KnowledgeReferenceError(
      'Knowledge method version is inaccessible',
    );
  }
  for (const link of content.referenceLinks ?? []) {
    const stored = await tx.referenceLinks.findFirst({
      where: {
        id: link.id,
        ownerId,
        targetRecordId: link.targetRecordId,
        targetCheckId: link.targetCheckId ?? null,
        targetObservationId: link.targetObservationId ?? null,
        targetAnchorId: link.targetAnchorId ?? null,
        records_reference_links_target_record_idTorecords: { ownerId },
      },
    });
    if (!stored) {
      throw new KnowledgeReferenceError(
        'Knowledge reference link is inaccessible',
      );
    }
  }
}

/**
 * verifies owner scope and immutable remote-image identity across aggregate links
 * @param context transaction and required owner
 * @param content complete validated content envelope
 */
async function validateAssociations(
  context: ReferenceContext,
  content: KnowledgeContentEnvelopeV2,
): Promise<void> {
  const { tx, ownerId } = context;
  const [topics, methods, related] = await Promise.all([
    tx.topic.count({
      where: {
        ownerId,
        id: { in: content.topics.map((topic) => topic.topicId) },
      },
    }),
    tx.inspectionMethods.count({
      where: { id: { in: content.methodIds }, knowledgeEntries: { ownerId } },
    }),
    tx.knowledgeEntries.count({
      where: { ownerId, id: { in: content.relatedEntryIds } },
    }),
  ]);
  if (
    topics !== content.topics.length ||
    methods !== content.methodIds.length ||
    related !== content.relatedEntryIds.length
  ) {
    throw new KnowledgeReferenceError(
      'Knowledge topic, method, related entry or image is inaccessible',
    );
  }
  await validateImages(context, content.images);
}

/**
 * verifies pinned evidence and aggregate links inside the revision write transaction
 * @param context transaction and required owner
 * @param content complete validated content envelope
 */
export async function validateReferences(
  context: ReferenceContext,
  content: KnowledgeContentEnvelopeV2,
): Promise<void> {
  for (const citation of content.citations) {
    await validateCitation(context, citation);
  }
  validateVariants(content);
  await validateLinks(context, content);
  await validateAssociations(context, content);
}
