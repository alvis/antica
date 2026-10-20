import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { corpusFileSchema } from '@antica/contracts';

import { canonicalJson, sha256 } from '../canonical.js';

import { createCorpusFixture } from './corpus.js';

import type { CorpusExaminationGuide, CorpusSource } from '@antica/contracts';

import type { CorpusDocument } from '../validate.js';

/** independently mutable guide and its exclusively owned source */
export interface GuideFixture {
  guide: CorpusExaminationGuide;
  source: CorpusSource;
}

const originalText = 'Observe the foot ring under raking light.';
const imageUrl = 'https://example.org/guide/foot.jpg';
const payload = { description: originalText, imageUrl };
const payloadHash = sha256(canonicalJson(payload));
const source: CorpusSource = {
  formatVersion: 1,
  kind: 'source',
  id: 'antica:source:guide-book',
  provider: 'guide-library',
  objectId: 'guide-book',
  title: 'Observation handbook',
  sourcePageUrl: 'https://example.org/books/guide',
  languages: ['en'],
  contributors: [],
  retrievedAt: '2026-10-20T12:00:00.000Z',
  providerSchemaVersion: 'fixture-1',
  licenceBasis: 'collector_authorization',
  authorizationNote:
    "2026-10-20: I've got the authorization already. I'm making app for them. include all information you find.",
  payload,
  payloadHash,
  fieldRights: [],
  locators: [
    {
      kind: 'structured',
      id: 'antica:locator:guide-foot',
      provider: 'guide-library',
      objectId: 'guide-book',
      fieldPath: '/description',
      valueHash: sha256(canonicalJson(originalText)),
      excerpt: originalText,
      url: 'https://example.org/books/guide',
      retrievedAt: '2026-10-20T12:00:00.000Z',
    },
  ],
  citations: [
    {
      id: 'antica:citation:guide-foot',
      sourceContentId: 'antica:source:guide-book',
      payloadHash,
      locatorId: 'antica:locator:guide-foot',
      relation: 'supports',
      quote: originalText,
    },
  ],
  images: [
    {
      id: 'antica:image:guide-foot',
      remoteUrl: imageUrl,
      sourcePageUrl: 'https://example.org/books/guide',
      provider: 'guide-library',
      status: 'available',
      showable: true,
      role: 'typical',
      locatorId: 'antica:locator:guide-foot',
    },
  ],
};
const labels = [
  { language: 'en', text: 'Foot ring', kind: 'preferred' as const },
  { language: 'zh-Hant', text: '足圈', kind: 'preferred' as const },
];
const fields = ['what', 'why', 'howToSee', 'typical', 'warningSigns'] as const;
const guide: CorpusExaminationGuide = {
  formatVersion: 1,
  kind: 'examination_guide',
  id: 'antica:guide:foot',
  guideVersion: 1,
  category: 'ceramics',
  titles: labels,
  appliesToTopicIds: ['antica:topic:ceramics'],
  framing: 'observation_not_verdict',
  externalObjectIds: [source.id],
  editorialReview: { state: 'pending' },
  checks: [
    {
      checkKey: 'foot-ring',
      group: 'base_marks',
      ordinal: 0,
      labels,
      statements: fields.map((field) => ({
        field,
        claimKey: `foot-${field}`,
        ordinal: 0,
        originalText,
        originalLanguage: 'en',
        statementType: 'observation',
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
      })),
      imageIds: [source.images[0]!.id],
      relatedEntryIds: ['antica:entry:ceramics:0'],
      capture: { view: 'base', light: 'raking', magnification: 'loupe_10x' },
    },
  ],
};

/**
 * creates isolated guidance and evidence for mutable test scenarios
 * @returns fresh guide and supporting book capture
 */
export function createGuideFixture(): GuideFixture {
  return structuredClone({ guide, source });
}

/**
 * appends a 1.1 release while retaining immutable legacy membership
 * @param fixture guide and source, optionally edited for a negative scenario
 * @returns complete multi-release corpus with fresh exact-byte hashes
 */
export function createGuideCorpusFixture(
  fixture: GuideFixture = createGuideFixture(),
): CorpusDocument[] {
  const legacy = createCorpusFixture();
  const releaseDocument = legacy.find(
    (document) => document.path === 'releases/1.0.0.json',
  )!;
  const release = corpusFileSchema.parse(JSON.parse(releaseDocument.text));
  if (release.kind !== 'release') {
    throw new Error('Expected fixture release');
  }
  const members = [
    ...legacy.filter((document) => !document.path.startsWith('releases/')),
    {
      path: 'sources/guide/book.json',
      text: `${canonicalJson(fixture.source)}\n`,
    },
    { path: 'guides/foot.json', text: `${canonicalJson(fixture.guide)}\n` },
  ];
  const { manifestHash: _previousHash, ...previous } = release;
  const manifest = {
    ...previous,
    version: '1.1.0',
    files: members
      .map((document) => ({
        path: document.path,
        sha256: sha256(document.text),
      }))
      .sort((left, right) => left.path.localeCompare(right.path)),
  };

  return [
    ...members,
    releaseDocument,
    {
      path: 'releases/1.1.0.json',
      text: `${canonicalJson({ ...manifest, manifestHash: sha256(canonicalJson(manifest)) })}\n`,
    },
  ];
}

/**
 * writes a disposable corpus for the real command loader
 * @param documents generated fixture documents
 * @returns temporary directory; the caller owns removal
 */
export function writeGuideCorpusFixture(
  documents: readonly CorpusDocument[],
): string {
  const directory = mkdtempSync(join(tmpdir(), 'antica-kdb31-guides-'));
  for (const document of documents) {
    const path = join(directory, document.path);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, document.text);
  }

  return directory;
}
