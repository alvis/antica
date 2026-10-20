import {
  knowledgeCitationV2Schema,
  structuredSourceSnapshotSchema,
} from '@antica/contracts';

import { jsonValue, nullableJson } from '../json.js';

import { canonicalHash } from './knowledge/canonical.js';
import { validateCitation } from './knowledge/references.js';

import type {
  KnowledgeContentEnvelopeV2,
  StructuredSourceSnapshot,
} from '@antica/contracts';

import type { sources } from '../generated/client.js';
import type { Transaction } from '../transaction.js';

/** identifies a new immutable version of an existing owner source */
export interface StructuredSourceVersionInput {
  readonly id: string;
  readonly sourceId: string;
  readonly snapshot: StructuredSourceSnapshot;
}

/**
 * validates payload bytes and compound identity before persisting structured metadata
 * @param tx transaction owning the source-version append
 * @param ownerId required owner of the source
 * @param input pinned version identity and canonical metadata snapshot
 * @returns the existing or newly appended version identifier
 */
export async function createStructuredSourceVersion(
  tx: Transaction,
  ownerId: string,
  input: StructuredSourceVersionInput,
): Promise<string> {
  const snapshot = structuredSourceSnapshotSchema.parse(input.snapshot);
  const { provider, objectId, payloadHash, schemaVersion } = snapshot;
  if (
    payloadHash !== canonicalHash(snapshot.payload) ||
    snapshot.sourceHash !==
      canonicalHash({ provider, objectId, payloadHash, schemaVersion })
  ) {
    throw new Error('Structured source payload or identity hash is invalid');
  }
  const source = await tx.sources.findFirst({
    where: { id: input.sourceId, ownerId },
  });
  if (!source) {
    throw new Error('Structured source is inaccessible');
  }
  const existing = await tx.sourceVersions.findFirst({
    where: { ownerId, sourceHash: snapshot.sourceHash },
  });
  if (existing) {
    if (existing.sourceId !== input.sourceId) {
      throw new Error(
        'Structured source identity belongs to a different source',
      );
    }

    return existing.id;
  }
  const external = await tx.externalObject.upsert({
    where: { ownerId_provider_objectId: { ownerId, provider, objectId } },
    create: {
      id: input.id,
      ownerId,
      sourceId: input.sourceId,
      provider,
      objectId,
      canonicalRecordUrl: snapshot.sourcePageUrl,
      lastSeenAt: new Date(snapshot.retrievedAt),
      status: 'active',
    },
    update: {},
  });
  if (external.sourceId !== input.sourceId) {
    throw new Error('Structured provider object belongs to a different source');
  }
  await persistStructuredVersion({ tx, ownerId }, source, {
    ...input,
    snapshot,
    externalObjectId: external.id,
  });

  return input.id;
}

/**
 * persists the exact structured payload with a complete immutable bibliography
 * @param context transaction and required source owner
 * @param context.tx transaction that appends the source version
 * @param context.ownerId required source owner
 * @param source existing source whose bibliography is captured
 * @param input validated version snapshot and provider object identity
 */
async function persistStructuredVersion(
  context: { readonly tx: Transaction; readonly ownerId: string },
  source: sources,
  input: StructuredSourceVersionInput & { readonly externalObjectId: string },
): Promise<void> {
  const { tx, ownerId } = context;
  const { snapshot } = input;
  const [contributors, languages] = await Promise.all([
    tx.sourceContributors.findMany({
      where: { sourceId: source.id },
      orderBy: { ordinal: 'asc' },
    }),
    tx.sourceLanguages.findMany({
      where: { sourceId: source.id },
      orderBy: { language: 'asc' },
    }),
  ]);
  await tx.sourceVersions.create({
    data: {
      id: input.id,
      sourceId: input.sourceId,
      ownerId,
      sourceHash: snapshot.sourceHash,
      metadataSnapshot: jsonValue({
        title: source.title,
        canonicalUrl: snapshot.sourcePageUrl,
        contributors: contributors.map(
          ({ nameAsPrinted, role, attribution }) => ({
            nameAsPrinted,
            role,
            attribution,
          }),
        ),
        languages: languages.map(({ language }) => language),
        authorStatus: source.authorStatus,
        editionStatement: source.editionStatement,
        publisher: source.publisher,
        publicationDateAsPrinted: source.publicationDateAsPrinted,
        isbn: source.isbn,
        access: source.access,
        rightsStatement: source.rightsStatement,
        attributionText: source.attributionText,
      }),
      capturedAt: snapshot.retrievedAt,
      retrievedAt: snapshot.retrievedAt,
      status: 'ready',
      textIndexStatus: 'not_requested',
      imageIndexStatus: 'not_requested',
      externalObjectId: input.externalObjectId,
      providerSchemaVersion: snapshot.schemaVersion,
      payloadHash: snapshot.payloadHash,
      structuredPayload: jsonValue(snapshot.payload),
      observedRights: nullableJson(snapshot.observedRights),
    },
  });
}

/**
 * appends a structured locator and citation only when the complete pinned chain validates
 * @param tx transaction owning source, locator and citation writes
 * @param ownerId required owner of the complete source chain
 * @param input citation carrying exact provider field location and source metadata
 */
export async function writeStructuredCitation(
  tx: Transaction,
  ownerId: string,
  input: KnowledgeContentEnvelopeV2['citations'][number],
): Promise<void> {
  const citation = knowledgeCitationV2Schema.parse(input);
  const locator = citation.locator;
  if (locator.kind !== 'structured') {
    throw new TypeError('Structured citation requires a structured locator');
  }
  const version = await tx.sourceVersions.findFirst({
    where: {
      id: locator.sourceVersionId,
      sourceId: locator.sourceId,
      ownerId,
      sources: { ownerId },
    },
  });
  if (!version) {
    throw new Error('Structured citation source is inaccessible');
  }
  await tx.sourceLocators.createMany({
    data: {
      id: locator.id,
      sourceId: locator.sourceId,
      sourceVersionId: locator.sourceVersionId,
      kind: 'structured',
      provider: locator.provider,
      objectId: locator.objectId,
      fieldPath: locator.fieldPath,
      valueHash: locator.valueHash,
      url: locator.url,
      retrievedAt: locator.retrievedAt,
      excerptAsRetrieved: locator.excerpt,
    },
    skipDuplicates: true,
  });
  await tx.citations.createMany({
    data: {
      id: citation.id,
      locatorId: locator.id,
      relation: citation.relation,
      availability: citation.availability,
      verification: citation.verification,
    },
    skipDuplicates: true,
  });
  await validateCitation({ tx, ownerId }, citation);
}
