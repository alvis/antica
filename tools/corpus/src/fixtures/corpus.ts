import { corpusFileSchema } from '@antica/contracts';

import { canonicalJson, sha256 } from '../canonical.js';

import type {
  CorpusEntry,
  CorpusFile,
  CorpusQueries,
  CorpusRelease,
  CorpusSource,
  CorpusTaxonomy,
} from '@antica/contracts';

import type { CorpusDocument } from '../validate.js';

type Category = CorpusEntry['category'];
interface CorpusMutation {
  path: string;
  update: (file: CorpusFile) => void;
  rehashPayload?: boolean;
}

const categories: readonly Category[] = [
  'ceramics',
  'bronzes',
  'jades',
  'furniture',
];
const providers = ['alpha', 'beta'] as const;
const categoryMinimum = 5;
const retrievedAt = '2026-10-18T12:00:00.000Z';
const releasePath = 'releases/1.0.0.json';

/**
 * Builds an independent, complete release at the required provider and entry minima.
 * @returns canonical corpus members and release manifest
 */
export function createCorpusFixture(): CorpusDocument[] {
  const taxonomy = createTaxonomy();
  const sources = categories.flatMap((category) =>
    providers.map((provider) => createSource(category, provider)),
  );
  const entries = categories.flatMap((category) =>
    Array.from({ length: 10 }, (_, index) =>
      createEntry(
        category,
        index,
        sources.find(
          (source) => source.objectId === `${category}-${providers[index % 2]}`,
        )!,
      ),
    ),
  );
  const queries: CorpusQueries = {
    formatVersion: 1,
    kind: 'owner_queries',
    provisional: true,
    questions: categories.flatMap((category) =>
      Array.from({ length: categoryMinimum }, (_, index) => ({
        id: `antica:query:${category}:${index}`,
        category,
        language: 'en',
        text: `What supports ${category} example ${index}?`,
        relevance: [{ entryId: `antica:entry:${category}:${index}`, grade: 3 }],
      })),
    ),
  };
  const members: CorpusDocument[] = [
    { path: 'taxonomy.json', text: `${canonicalJson(taxonomy)}\n` },
    ...sources.map((source) => ({
      path: `sources/${source.provider}/${source.objectId}.json`,
      text: `${canonicalJson(source)}\n`,
    })),
    ...entries.map((entry) => ({
      path: `entries/${entry.category}/${entry.id.split(':').at(-1)}.json`,
      text: `${canonicalJson(entry)}\n`,
    })),
    { path: 'queries/owner.json', text: `${canonicalJson(queries)}\n` },
  ];
  const release = createRelease(members);

  return [
    ...members,
    { path: releasePath, text: `${canonicalJson(release)}\n` },
  ];
}

/**
 * Mutates one parsed fixture file and refreshes dependent exact-byte manifest hashes.
 * @param documents valid starting release
 * @param mutation file edit and hash policy
 * @returns edited release with refreshed exact-byte membership
 */
export function mutateCorpusFixture(
  documents: readonly CorpusDocument[],
  mutation: CorpusMutation,
): CorpusDocument[] {
  const { path, update, rehashPayload = true } = mutation;
  const changed = documents.map((document) => {
    if (document.path !== path) {
      return { ...document };
    }
    const file = corpusFileSchema.parse(JSON.parse(document.text));
    update(file);
    if (file.kind === 'source' && rehashPayload) {
      file.payloadHash = sha256(canonicalJson(file.payload));
      file.citations.forEach((citation) => {
        citation.payloadHash = file.payloadHash;
      });
    }
    if (file.kind === 'release') {
      const { manifestHash, ...releaseWithoutHash } = file;
      void manifestHash;
      file.manifestHash = sha256(canonicalJson(releaseWithoutHash));
    }

    return { path, text: `${canonicalJson(file)}\n` };
  });
  if (path === releasePath) {
    return changed;
  }
  const release = createRelease(
    changed.filter((document) => document.path !== releasePath),
  );

  return changed.map((document) =>
    document.path === releasePath
      ? { path: releasePath, text: `${canonicalJson(release)}\n` }
      : document,
  );
}

/**
 * Builds the four exact category roots required by the release policy.
 * @returns bilingual category taxonomy
 */
function createTaxonomy(): CorpusTaxonomy {
  return {
    formatVersion: 1,
    kind: 'taxonomy',
    topics: categories.map((category, sortOrder) => ({
      id: `antica:topic:${category}`,
      facet: 'category',
      sortOrder,
      labels: [
        { language: 'zh-Hant', text: `${category} 中文`, kind: 'preferred' },
        { language: 'en', text: category, kind: 'preferred' },
      ],
      relatedIds: [],
      mappings: [],
    })),
  };
}

/**
 * Creates one supporting provider snapshot for a category.
 * @param category category containing the object
 * @param provider distinct provider name
 * @returns source with located text and a declared image
 */
function createSource(category: Category, provider: string): CorpusSource {
  const objectId = `${category}-${provider}`;
  const description = `Captured evidence for ${objectId}`;
  const imageUrl = `https://example.org/images/${objectId}.jpg`;
  const payload = { description, imageUrl };
  const payloadHash = sha256(canonicalJson(payload));
  const id = `museum:${provider}:object:${objectId}`;
  const locatorId = `antica:locator:${objectId}`;
  const url = `https://example.org/${objectId}`;

  return {
    formatVersion: 1,
    kind: 'source',
    id,
    provider,
    objectId,
    sourcePageUrl: url,
    title: objectId,
    languages: ['en'],
    contributors: [],
    retrievedAt,
    payloadHash,
    providerSchemaVersion: 'fixture-1',
    payload,
    fieldRights: [],
    locators: [
      {
        kind: 'structured',
        id: locatorId,
        provider,
        objectId,
        fieldPath: '/description',
        valueHash: sha256(canonicalJson(description)),
        excerpt: description,
        url,
        retrievedAt,
      },
    ],
    citations: [
      {
        id: `antica:citation:${objectId}`,
        sourceContentId: id,
        payloadHash,
        locatorId,
        relation: 'supports',
        quote: description,
      },
    ],
    images: [
      {
        id: `antica:image:${objectId}`,
        remoteUrl: imageUrl,
        sourcePageUrl: url,
        provider,
        status: 'unchecked',
      },
    ],
  };
}

/**
 * Creates one cited entry at an exact category minimum boundary.
 * @param category category root
 * @param index stable entry index
 * @param source provider evidence for the claim
 * @returns cited entry with an original text variant
 */
function createEntry(
  category: Category,
  index: number,
  source: CorpusSource,
): CorpusEntry {
  const originalText = `Captured evidence for ${source.objectId}`;

  return {
    formatVersion: 1,
    kind: 'entry',
    id: `antica:entry:${category}:${index}`,
    contentSchemaVersion: 2,
    entryType: index < categoryMinimum ? 'concept' : 'object_example',
    category,
    titles: [
      { language: 'en', text: `${category} ${index}`, kind: 'preferred' },
      {
        language: 'zh-Hant',
        text: `${category} 中文 ${index}`,
        kind: 'preferred',
      },
    ],
    aliases: [],
    topics: [{ topicId: `antica:topic:${category}`, applicability: 'general' }],
    claims: [
      {
        claimKey: `claim-${index}`,
        section: 'summary',
        ordinal: 0,
        originalText,
        originalLanguage: 'en',
        statementType: 'source_attribution',
        scope: {},
        qualifiers: {},
        supportState: 'cited',
        citationIds: [source.citations[0]!.id],
        review: { state: 'pending' },
        variants: [
          {
            language: 'en',
            kind: 'original',
            text: originalText,
            method: 'original',
            sourceTextHash: sha256(originalText),
            review: { state: 'pending' },
          },
        ],
      },
    ],
    imageIds: [],
    externalObjectIds: [source.id],
    editorialReview: { state: 'pending' },
  };
}

/**
 * Builds the release digest from exact member bytes.
 * @param members canonical corpus files
 * @returns self-excluding release manifest
 */
function createRelease(members: readonly CorpusDocument[]): CorpusRelease {
  const releaseWithoutHash = {
    formatVersion: 1 as const,
    kind: 'release' as const,
    corpusId: 'antica:corpus:v1',
    version: '1.0.0',
    files: members
      .map((member) => ({ path: member.path, sha256: sha256(member.text) }))
      .sort((left, right) => left.path.localeCompare(right.path)),
    rightsNotices: [],
  };

  return {
    ...releaseWithoutHash,
    manifestHash: sha256(canonicalJson(releaseWithoutHash)),
  };
}
