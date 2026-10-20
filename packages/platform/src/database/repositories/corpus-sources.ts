import { createHash } from 'node:crypto';

import { nullableJson } from '../json.js';

import { createStructuredSourceVersion } from './structured-sources.js';

import type { CorpusSource } from '@antica/contracts';

import type { Transaction } from '../transaction.js';

import type { CorpusContent } from './corpus-content.js';

/** owner and evidence identities shared by one snapshot transaction */
export interface CorpusSourceContext {
  readonly tx: Transaction;
  readonly ownerId: string;
  readonly content: CorpusContent;
}

/**
 * installs one bounded snapshot through the structured-source repository
 * @param context batch transaction, required source owner and deterministic identities
 * @param source validated metadata, locators, citations and all image URLs
 */
export async function installCorpusSource(
  context: CorpusSourceContext,
  source: CorpusSource,
): Promise<void> {
  const { tx, ownerId, content } = context;
  const sourceId = content.sourceId(source);
  const sourceVersionId = content.versionId(source);
  const existing = await tx.sourceVersions.findFirst({
    where: { id: sourceVersionId, ownerId },
  });
  if (existing) {
    return;
  }
  await writeBibliography(context, source);
  const id = await createStructuredSourceVersion(tx, ownerId, {
    id: sourceVersionId,
    sourceId,
    snapshot: content.snapshot(source),
  });
  if (id !== sourceVersionId) {
    throw new Error(
      'Corpus metadata changed without a new provider payload; a new source snapshot is required',
    );
  }
  await writeEvidence(context, source);
  await tx.sources.update({
    where: { id: sourceId, ownerId },
    data: { currentVersionId: sourceVersionId },
  });
  await tx.externalObject.updateMany({
    where: { ownerId, sourceId },
    data: { canonicalRecordUrl: source.sourcePageUrl },
  });
}

/**
 * captures source bibliography before appending an immutable version
 * @param context owner-scoped batch context
 * @param source validated source snapshot
 */
async function writeBibliography(
  context: CorpusSourceContext,
  source: CorpusSource,
): Promise<void> {
  const { tx, ownerId, content } = context;
  const sourceId = content.sourceId(source);
  const bibliography = {
    title: source.title,
    canonicalUrl: source.locators[0]!.url,
    rightsStatement: source.rights?.statement ?? null,
  };
  await tx.sources.upsert({
    where: { id: sourceId, ownerId },
    create: {
      id: sourceId,
      ownerId,
      kind: 'structured_open_data',
      authorStatus: 'identified',
      access: 'open',
      ...bibliography,
    },
    update: bibliography,
  });
  await tx.sourceContributors.deleteMany({ where: { sourceId } });
  await tx.sourceContributors.createMany({
    data: source.contributors.map((nameAsPrinted, ordinal) => ({
      sourceId,
      ordinal,
      nameAsPrinted,
      role: 'author',
      attribution: 'credited',
    })),
  });
  await tx.sourceLanguages.deleteMany({ where: { sourceId } });
  await tx.sourceLanguages.createMany({
    data: source.languages.map((language) => ({ sourceId, language })),
  });
}

/**
 * persists grouped immutable locators and citations
 * @param context owner-scoped batch context
 * @param source validated source snapshot
 */
async function writeEvidence(
  context: CorpusSourceContext,
  source: CorpusSource,
): Promise<void> {
  const { tx, content } = context;
  const sourceId = content.sourceId(source);
  const sourceVersionId = content.versionId(source);
  await tx.sourceLocators.createMany({
    data: [
      ...new Map(
        source.locators.map((locator) => [
          content.childId(source, locator.id),
          locator,
        ]),
      ).values(),
    ].map((locator) => ({
      id: content.childId(source, locator.id),
      sourceId,
      sourceVersionId,
      kind: locator.kind,
      url: locator.url,
      retrievedAt: locator.retrievedAt,
      excerptAsRetrieved: locator.excerpt,
      ...(locator.kind === 'structured'
        ? {
            provider: locator.provider,
            objectId: locator.objectId,
            fieldPath: locator.fieldPath,
            valueHash: locator.valueHash,
          }
        : {}),
    })),
  });
  await tx.citations.createMany({
    data: source.citations.map((citation) => ({
      id: content.childId(source, citation.id),
      locatorId: content.childId(source, citation.locatorId),
      relation: citation.relation,
      availability: 'link_only',
      verification: 'located',
    })),
  });
  await writeImages(context, source);
}

/**
 * retains every remote image URL and observed rights
 * @param context owner-scoped batch context
 * @param source validated source snapshot
 */
async function writeImages(
  context: CorpusSourceContext,
  source: CorpusSource,
): Promise<void> {
  const { tx, content } = context;
  const sourceVersionId = content.versionId(source);
  if (source.images.length) {
    await tx.referenceImages.createMany({
      data: source.images.map((image) => ({
        id: content.childId(source, image.id),
        sourceVersionId,
        locatorId: content.childId(
          source,
          image.locatorId ?? source.locators[0]!.id,
        ),
        externalImageUrl: image.remoteUrl,
        sourcePageUrl: image.sourcePageUrl,
        provider: image.provider,
        providerImageId: image.providerImageId,
        width: image.width,
        height: image.height,
        observedRights: nullableJson(image.rights),
        lastCheckedAt: image.lastCheckedAt,
        status: image.status,
        captionAssociation: 'unassociated',
        remoteUrlHash: createHash('sha256')
          .update(image.remoteUrl)
          .digest('hex'),
      })),
    });
  }
}
