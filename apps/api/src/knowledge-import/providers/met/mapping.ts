import { KnowledgeProviderError } from '@antica/contracts';

import { hash, stableId } from './canonical.js';
import {
  createCitation,
  excerpt,
  observeRights,
  readRecord,
} from './evidence.js';
import { collectImages } from './images.js';

import type { MappedObject, ProviderSnapshot } from '@antica/contracts';

import type { MetRecord } from './evidence.js';

/** represents an installed active taxonomy label available to the import owner */
export interface MetTopicLabel {
  readonly topicId: string;
  readonly facet: string;
  readonly text: string;
}

interface MappingContext {
  readonly snapshot: ProviderSnapshot;
  readonly source: MappedObject['source'];
  readonly record: MetRecord & { readonly title: string };
}

interface FieldClaimContext {
  readonly field: string;
  readonly ordinal: number;
  readonly text: string;
  readonly citationId: string;
}

const mappedFields = [
  'title',
  'objectID',
  'accessionNumber',
  'objectName',
  'culture',
  'period',
  'dynasty',
  'reign',
  'constituents',
  'artistRole',
  'artistPrefix',
  'artistDisplayName',
  'artistDisplayBio',
  'artistSuffix',
  'artistAlphaSort',
  'artistNationality',
  'artistBeginDate',
  'artistEndDate',
  'artistGender',
  'artistWikidata_URL',
  'artistULAN_URL',
  'objectDate',
  'objectBeginDate',
  'objectEndDate',
  'medium',
  'dimensions',
  'measurements',
  'creditLine',
  'rightsAndReproduction',
  'objectURL',
  'metadataDate',
  'tags',
  'objectWikidata_URL',
  'classification',
  'isPublicDomain',
];

/**
 * maps exact captured museum evidence to a pending object-example draft
 * @param snapshot immutable provider response
 * @param topics installed taxonomy labels
 * @returns attributed claims and every discovered image URL
 * @throws {KnowledgeProviderError} when the captured object identity or title is invalid
 */
export function mapMetSnapshot(
  snapshot: ProviderSnapshot,
  topics: readonly MetTopicLabel[] = [],
): MappedObject {
  const record = readRecord(snapshot.payload);
  if (
    snapshot.provider !== 'met' ||
    typeof record.objectID !== 'number' ||
    String(record.objectID) !== snapshot.objectId ||
    typeof record.title !== 'string' ||
    !record.title.trim()
  ) {
    throw new KnowledgeProviderError({
      code: 'INVALID_RESPONSE',
      retryable: false,
    });
  }
  const source: MappedObject['source'] = {
    id: stableId(`met:${snapshot.objectId}:source`),
    versionId: stableId(
      `met:${snapshot.objectId}:${snapshot.payloadHash}:version`,
    ),
    title: record.title,
    canonicalUrl: snapshot.sourcePageUrl,
    languages: ['en'],
    contributors: ['The Metropolitan Museum of Art'],
  };

  return {
    externalObject: {
      provider: 'met',
      objectId: snapshot.objectId,
      canonicalRecordUrl: snapshot.sourcePageUrl,
      upstreamModifiedAt: parseModifiedAt(record.metadataDate),
    },
    source,
    draft: createDraft(
      { snapshot, source, record: { ...record, title: record.title } },
      topics,
    ),
  };
}

/**
 * composes granular field evidence before adding image references
 * @param context captured response and pinned source
 * @returns pending attributed claims and exact field citations
 */
function mapFields(
  context: MappingContext,
): Pick<MappedObject['draft'], 'claims' | 'citations'> {
  const { record, source, snapshot } = context;
  const fields = mappedFields.flatMap((field) => {
    const value = record[field];

    return value === undefined || value === '' ? [] : [{ field, value }];
  });
  const citations = fields.map(({ field, value }) =>
    createCitation({
      source,
      snapshot,
      fieldPath: `/${field}`,
      value,
    }),
  );
  const claims = fields.map(({ field, value }, ordinal) =>
    createClaim({
      field,
      ordinal,
      text: excerpt(value),
      citationId: citations[ordinal]!.id,
    }),
  );

  return { claims, citations };
}

/**
 * links every distinct URL to its own exact source locator
 * @param context captured response and pinned source
 * @returns image metadata and located evidence
 */
function mapImages(
  context: MappingContext,
): Pick<MappedObject['draft'], 'images' | 'citations'> {
  const { source, snapshot } = context;
  const images = collectImages(snapshot.payload);
  const imageCitations = images.map((image) =>
    createCitation({
      source,
      snapshot,
      fieldPath: image.fieldPath,
      value: image.url,
    }),
  );
  const rights = observeRights(snapshot);

  return {
    citations: imageCitations,
    images: images.map((image, index) => ({
      id: stableId(`${source.versionId}:image:${image.url}`),
      sourceVersionId: source.versionId,
      imageUrl: image.url,
      sourcePageUrl: snapshot.sourcePageUrl,
      provider: 'met',
      status: 'unchecked',
      locatorId: imageCitations[index]!.locator.id,
      observedRights: rights[0],
    })),
  };
}

/**
 * composes a pending example from attributed source evidence
 * @param context captured response and pinned source
 * @param topics installed owner-scoped taxonomy labels
 * @returns an unreviewed version-two envelope
 */
function createDraft(
  context: MappingContext,
  topics: readonly MetTopicLabel[],
): MappedObject['draft'] {
  const { record } = context;
  const { claims, citations } = mapFields(context);
  const imageEvidence = mapImages(context);
  const titleClaim = claims[0]!;

  return {
    contentSchemaVersion: 2,
    entryType: 'object_example',
    origin: 'open_import',
    titles: [{ language: 'en', text: record.title }],
    aliases: [],
    editorialReview: { state: 'pending' },
    sections: {
      summary: {
        claimKey: 'title',
        text: titleClaim.originalText,
        citationIds: titleClaim.citationIds,
        supportState: 'cited',
      },
      history: [],
      features: claims.slice(1).map((claim) => ({
        claimKey: claim.claimKey,
        text: claim.originalText,
        citationIds: claim.citationIds,
        supportState: 'cited',
      })),
      applicability: [],
      limits: [],
    },
    claims,
    citations: [...citations, ...imageEvidence.citations],
    images: imageEvidence.images,
    topics: matchTopics(record, topics),
    methodIds: [],
    relatedEntryIds: [],
  };
}

/**
 * attributes one museum field without turning it into an authenticity rule
 * @param context field identity, exact excerpt and supporting citation
 * @returns an unreviewed original-language claim
 */
function createClaim(
  context: FieldClaimContext,
): MappedObject['draft']['claims'][number] {
  const originalText = `The museum records ${context.field}: ${context.text}`;

  return {
    claimKey: context.field,
    section: context.field === 'title' ? 'summary' : 'features',
    ordinal: Math.max(0, context.ordinal - 1),
    originalText,
    originalLanguage: 'en',
    statementType: 'source_attribution',
    scope: {},
    qualifiers: {},
    supportState: 'cited',
    citationIds: [context.citationId],
    review: { state: 'pending' },
    variants: [
      {
        language: 'en',
        kind: 'original',
        text: originalText,
        method: 'original',
        sourceTextHash: hash(originalText),
        review: { state: 'pending' },
      },
    ],
  };
}

/**
 * links only exact normalized hints to installed labels in the relevant facets
 * @param record captured culture, object name and classification wording
 * @param topics owner-scoped active taxonomy labels
 * @returns specific pending-example associations without inventing topics
 */
function matchTopics(
  record: MetRecord,
  topics: readonly MetTopicLabel[],
): MappedObject['draft']['topics'] {
  const hints = [
    { value: record.culture, facets: ['region', 'period'] },
    { value: record.objectName, facets: ['category', 'object_type'] },
    {
      value: record.classification,
      facets: ['category', 'object_type', 'material'],
    },
  ];
  const matched = topics.filter((label) =>
    hints.some((hint) => {
      const values = Array.isArray(hint.value) ? hint.value : [hint.value];

      return (
        hint.facets.includes(label.facet) &&
        values.some(
          (value) =>
            typeof value === 'string' &&
            normalizeLabel(value) === normalizeLabel(label.text),
        )
      );
    }),
  );

  return [...new Set(matched.map((label) => label.topicId))]
    .sort()
    .map((topicId) => ({ topicId, applicability: 'specific' }));
}

/**
 * normalizes search copies while preserving the captured wording
 * @param text museum hint or installed label
 * @returns comparable Unicode label
 */
function normalizeLabel(text: string): string {
  return text.normalize('NFKC').trim().toLowerCase().replaceAll(/\s+/g, ' ');
}

/**
 * normalizes the museum's metadataDate without changing the captured value
 * @param value captured modification timestamp
 * @returns ISO instant when the museum supplied a valid date
 */
export function parseModifiedAt(
  value: MetRecord[string] | undefined,
): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const timestamp = Date.parse(value);

  return Number.isFinite(timestamp)
    ? new Date(timestamp).toISOString()
    : undefined;
}
