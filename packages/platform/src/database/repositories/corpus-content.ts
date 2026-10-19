import { knowledgeContentEnvelopeV2Schema } from '@antica/contracts';

import { corpusId } from './corpus-identity.js';
import { canonicalHash } from './knowledge/canonical.js';

import type {
  CorpusEntry,
  CorpusSource,
  KnowledgeContentEnvelopeV2,
  StructuredSourceSnapshot,
} from '@antica/contracts';

type Citation = KnowledgeContentEnvelopeV2['citations'][number];
type Image = KnowledgeContentEnvelopeV2['images'][number];
/** owner-scoped immutable evidence identities and envelope conversion */
export interface CorpusContent {
  readonly sourceId: (source: CorpusSource) => string;
  readonly versionId: (source: CorpusSource) => string;
  readonly childId: (source: CorpusSource, id: string) => string;
  readonly snapshot: (source: CorpusSource) => StructuredSourceSnapshot;
  readonly entry: (entry: CorpusEntry) => KnowledgeContentEnvelopeV2;
}
/**
 * maps validated corpus identifiers to owner-scoped pinned v2 envelopes
 * @param ownerId required collector identity
 * @param sources all validated snapshots in the selected release
 * @returns deterministic evidence and envelope conversion capabilities
 */
export function createCorpusContent(
  ownerId: string,
  sources: readonly CorpusSource[],
): CorpusContent {
  const sourceId = (source: CorpusSource): string =>
    corpusId(ownerId, `source:${source.provider}:${source.objectId}`);
  const versionId = (source: CorpusSource): string =>
    corpusId(ownerId, `version:${source.id}:${canonicalHash(source)}`);
  const childId = (source: CorpusSource, id: string): string => {
    const locator = source.locators.find((locator) => locator.id === id);
    const { id: _id, ...location } = locator ?? { id };
    const identity =
      locator?.kind === 'structured' ? canonicalHash(location) : id;

    return corpusId(ownerId, `${versionId(source)}:${identity}`);
  };
  const identities = { sourceId, versionId, childId, snapshot: sourceSnapshot };
  const citations = new Map(
    sources.flatMap((source) =>
      source.citations.map((citation) => [
        citation.id,
        convertCitation(source, citation, identities),
      ]),
    ),
  );
  const images = new Map(
    sources.flatMap((source) =>
      source.images.map((image) => [
        image.id,
        convertImage(source, image, identities),
      ]),
    ),
  );

  return {
    ...identities,
    entry: (entry) => convertEntry(entry, { ownerId, citations, images }),
  };
}

/**
 * preserves canonical provider metadata and observed rights, including field assignments
 * @param source validated source
 * @returns structured-source repository snapshot
 */
function sourceSnapshot(source: CorpusSource): StructuredSourceSnapshot {
  const identity = {
    provider: source.provider,
    objectId: source.objectId,
    payloadHash: source.payloadHash,
    schemaVersion: source.providerSchemaVersion,
  };

  return {
    ...identity,
    sourceHash: canonicalHash(identity),
    sourcePageUrl: source.locators[0]!.url,
    retrievedAt: source.retrievedAt,
    payload: source.payload,
    observedRights: [
      ...(source.rights ? [source.rights] : []),
      ...source.fieldRights,
    ],
  };
}
/**
 * pins a corpus citation to the owner snapshot and captured locator
 * @param source captured source
 * @param citation corpus citation
 * @param ids owner-scoped identities
 * @returns v2 evidence envelope
 */
function convertCitation(
  source: CorpusSource,
  citation: CorpusSource['citations'][number],
  ids: Omit<CorpusContent, 'entry'>,
): Citation {
  const locator = source.locators.find(
    (item) => item.id === citation.locatorId,
  )!;
  const location =
    locator.kind === 'web'
      ? {
          kind: locator.kind,
          url: locator.url,
          retrievedAt: locator.retrievedAt,
          excerpt: locator.excerpt,
        }
      : locator;

  return {
    id: ids.childId(source, citation.id),
    relation: citation.relation,
    availability: 'link_only',
    verification: 'located',
    quote: citation.quote,
    locator: {
      ...location,
      id: ids.childId(source, locator.id),
      sourceId: ids.sourceId(source),
      sourceVersionId: ids.versionId(source),
    },
    source: {
      id: ids.sourceId(source),
      versionId: ids.versionId(source),
      title: source.title,
      canonicalUrl: source.locators[0]!.url,
      languages: source.languages,
      contributors: source.contributors,
      structuredSnapshot: ids.snapshot(source),
    },
  };
}
/**
 * retains remote image metadata without acquiring any image bytes
 * @param source captured source
 * @param image corpus image
 * @param ids owner-scoped identities
 * @returns pinned v2 image
 */
function convertImage(
  source: CorpusSource,
  image: CorpusSource['images'][number],
  ids: Omit<CorpusContent, 'entry'>,
): Image {
  const { id, remoteUrl, rights, locatorId, ...metadata } = image;

  return {
    ...metadata,
    id: ids.childId(source, id),
    imageUrl: remoteUrl,
    sourceVersionId: ids.versionId(source),
    locatorId: ids.childId(source, locatorId ?? source.locators[0]!.id),
    ...(rights ? { observedRights: rights } : {}),
  };
}
interface EntryContext {
  readonly ownerId: string;
  readonly citations: ReadonlyMap<string, Citation>;
  readonly images: ReadonlyMap<string, Image>;
}
/**
 * constructs the canonical envelope consumed by the existing v2 revision writer
 * @param entry validated curated entry
 * @param context owner and pinned evidence indexes
 * @returns validated revision content
 */
function convertEntry(
  entry: CorpusEntry,
  context: EntryContext,
): KnowledgeContentEnvelopeV2 {
  const { ownerId, citations, images } = context;
  const claims = entry.claims.map((claim) => ({
    ...claim,
    citationIds: claim.citationIds.map((id) => citations.get(id)!.id),
  }));
  const nodes = (
    section: string,
  ): KnowledgeContentEnvelopeV2['sections']['history'] =>
    claims
      .filter((claim) => claim.section === section)
      .sort((a, b) => a.ordinal - b.ordinal)
      .map((claim) => ({
        claimKey: claim.claimKey,
        text: claim.originalText,
        citationIds: claim.citationIds,
        supportState: claim.supportState,
      }));

  return knowledgeContentEnvelopeV2Schema.parse({
    contentSchemaVersion: 2,
    entryType: entry.entryType,
    origin: 'curated_seed',
    titles: entry.titles.map(({ language, text }) => ({ language, text })),
    aliases: entry.aliases.map(({ language, text }) => ({ language, text })),
    claims,
    editorialReview: entry.editorialReview,
    sections: {
      summary: nodes('summary')[0],
      history: nodes('history'),
      features: nodes('features'),
      applicability: nodes('applicability'),
      limits: nodes('limits'),
    },
    topics: entry.topics.map((topic) => ({
      ...topic,
      topicId: corpusId(ownerId, topic.topicId),
    })),
    citations: [
      ...new Set(entry.claims.flatMap((claim) => claim.citationIds)),
    ].map((id) => citations.get(id)!),
    images: entry.imageIds.map((id) => images.get(id)!),
    methodIds: [],
    relatedEntryIds: [],
  });
}
