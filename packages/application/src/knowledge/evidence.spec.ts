import { createHash } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { knowledgeEvidenceSnapshotV1Schema } from '@antica/contracts';

import {
  buildKnowledgeEvidenceSnapshot,
  freezeKnowledgeEvidence,
  validateKnowledgeAnswerSegments,
} from './evidence.js';

import type {
  KnowledgeEntryDetailV2,
  KnowledgeEvidenceSnapshotV1,
  AnswerSegment,
  RelatedKnowledgePage,
} from '@antica/contracts';

import type { KnowledgeEvidenceReader } from './evidence.js';

const id = (value: number): string =>
  `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const now = '2026-10-19T00:00:00.000Z';
const review = { state: 'reviewed' as const, actor: id(1), at: now };
const originalText =
  'This museum object is porcelain; attribution remains uncertain.';
const citation: KnowledgeEntryDetailV2['content']['citations'][number] = {
  id: id(10),
  relation: 'supports',
  availability: 'unavailable',
  verification: 'located',
  quote: originalText,
  locator: {
    kind: 'web',
    id: id(11),
    sourceId: id(12),
    sourceVersionId: id(13),
    url: 'https://museum.example/object',
    retrievedAt: now,
    excerpt: originalText,
    section: 'Materials',
  },
  source: {
    id: id(12),
    versionId: id(13),
    title: 'Museum catalog',
    languages: ['en'],
    contributors: [],
  },
};
const claim: KnowledgeEntryDetailV2['content']['claims'][number] = {
  claimKey: 'material',
  section: 'summary',
  ordinal: 0,
  originalText,
  originalLanguage: 'en',
  statementType: 'observation',
  scope: { object: ['Museum object'] },
  qualifiers: { attribution: 'tentative' },
  uncertainty: 'Not a rule for every vessel',
  supportState: 'cited',
  citationIds: [citation.id],
  review,
  variants: [],
};
const entry: KnowledgeEntryDetailV2 = {
  id: id(20),
  displayCode: 'KN-20',
  revision: 1,
  status: 'saved',
  savedBy: 'collector',
  contentHash: 'a'.repeat(64),
  createdAt: now,
  updatedAt: now,
  content: {
    contentSchemaVersion: 2,
    entryType: 'object_example',
    origin: 'collector',
    titles: [{ language: 'en', text: 'Museum object' }],
    aliases: [],
    sections: {
      summary: {
        claimKey: claim.claimKey,
        text: originalText,
        supportState: 'cited',
        citationIds: [citation.id],
      },
      history: [],
      features: [],
      applicability: [],
      limits: [],
    },
    claims: [claim],
    citations: [citation],
    topics: [],
    images: [],
    methodIds: [],
    relatedEntryIds: [],
    editorialReview: review,
  },
};
const input = {
  snapshotId: id(30),
  recordId: id(31),
  recordRevision: 2,
  corpusGeneration: 'generation-1',
  entries: [entry],
  attachments: [],
};
const ref = {
  entryId: entry.id,
  revision: 1,
  claimKey: claim.claimKey,
  citationIds: [citation.id],
};

function snapshot(
  entries: readonly KnowledgeEntryDetailV2[] = [entry],
): KnowledgeEvidenceSnapshotV1 {
  const result = buildKnowledgeEvidenceSnapshot({ ...input, entries });
  if (!result.success) {
    throw new Error(result.error.message);
  }

  return result.data;
}

function withClaim(value: Partial<typeof claim>): KnowledgeEntryDetailV2 {
  return {
    ...entry,
    content: { ...entry.content, claims: [{ ...claim, ...value }] },
  };
}

describe('fn:buildKnowledgeEvidenceSnapshot', () => {
  it('should preserve complete applicability and located evidence even when remote media is unavailable', () => {
    const result = snapshot();
    expect(knowledgeEvidenceSnapshotV1Schema.safeParse(result).success).toBe(
      true,
    );
    expect(result.entries).toMatchObject([
      {
        entryId: entry.id,
        revision: 1,
        claims: [
          {
            statement: originalText,
            originalText,
            language: 'en',
            scope: claim.scope,
            qualifiers: claim.qualifiers,
            uncertainty: claim.uncertainty,
            sourceVersionIds: [id(13)],
            citations: [
              {
                citationId: citation.id,
                locatorId: id(11),
                relation: 'supports',
                excerpt: originalText,
              },
            ],
          },
        ],
      },
    ]);
  });

  it('should omit unsaved, uncited, unreviewed and unsupported claims independently', () => {
    const rejected = [
      { ...entry, status: 'draft' as const, savedBy: null },
      withClaim({ supportState: 'needs_source' }),
      withClaim({ review: { state: 'pending' } }),
      withClaim({ review: { state: 'rejected', actor: id(1), at: now } }),
      withClaim({ citationIds: [] }),
      withClaim({ citationIds: [id(99)] }),
      {
        ...entry,
        content: {
          ...entry.content,
          citations: [{ ...citation, relation: 'background' as const }],
        },
      },
      {
        ...entry,
        content: {
          ...entry.content,
          citations: [{ ...citation, verification: 'needs_review' as const }],
        },
      },
    ];
    for (const candidate of rejected) {
      expect(snapshot([candidate]).entries).toEqual([]);
    }
  });

  it('should use only a reviewed current translation and fall back to labelled original otherwise', () => {
    const translation = {
      language: 'zh-Hant',
      kind: 'translation' as const,
      text: '這件館藏為瓷器，歸屬尚未確定。',
      method: 'human' as const,
      sourceTextHash: createHash('sha256').update(originalText).digest('hex'),
      review,
    };
    expect(
      snapshot([withClaim({ variants: [translation] })]).entries[0]?.claims[0],
    ).toMatchObject({
      statement: translation.text,
      language: 'zh-Hant',
      originalText,
    });
    for (const variant of [
      { ...translation, review: { state: 'pending' as const } },
      { ...translation, sourceTextHash: 'b'.repeat(64) },
    ]) {
      expect(
        snapshot([withClaim({ variants: [variant] })]).entries[0]?.claims[0],
      ).toMatchObject({
        statement: originalText,
        language: 'en',
        originalText,
      });
    }
  });

  it('should cap whole entries, claims and citations without truncating meaning', () => {
    const citations = Array.from({ length: 4 }, (_, index) => ({
      ...citation,
      id: id(40 + index),
    }));
    const entries = Array.from({ length: 4 }, (_, index) => ({
      ...entry,
      id: id(50 + index),
      content: {
        ...entry.content,
        citations,
        claims: Array.from({ length: 3 }, (_, ordinal) => ({
          ...claim,
          claimKey: `claim-${ordinal}`,
          ordinal,
          citationIds: citations.map((item) => item.id),
        })),
      },
    }));
    const result = snapshot(entries);
    expect(result.entries.length).toBeLessThanOrEqual(3);
    expect(result.entries.flatMap((item) => item.claims)).toHaveLength(6);
    for (const item of result.entries.flatMap((item) => item.claims)) {
      expect(item).toMatchObject({
        statement: originalText,
        scope: claim.scope,
        uncertainty: claim.uncertainty,
      });
      expect(item.citations).toHaveLength(3);
    }
    expect(
      snapshot(
        entries.map((item) => ({
          ...item,
          content: { ...item.content, claims: [claim], citations: [citation] },
        })),
      ).entries,
    ).toHaveLength(3);
  });

  it('should skip an oversized UTF-8 claim whole and retain the next supported claim', () => {
    const oversized = {
      ...claim,
      claimKey: 'oversized',
      originalText: '瓷'.repeat(4_100),
    };
    const result = snapshot([
      { ...entry, content: { ...entry.content, claims: [oversized, claim] } },
    ]);
    expect(result.entries[0]?.claims.map((item) => item.claimKey)).toEqual([
      claim.claimKey,
    ]);
  });

  it('should reject every invalid attachment before caps can hide it', () => {
    expect(
      buildKnowledgeEvidenceSnapshot({
        ...input,
        attachments: Array.from({ length: 7 }, () => ref),
      }),
    ).toMatchObject({ success: false, error: { code: 'EVIDENCE_INVALID' } });
    const invalid = [
      { ...ref, entryId: id(99) },
      { ...ref, revision: 2 },
      { ...ref, claimKey: 'unknown' },
      { ...ref, citationIds: [id(99)] },
      { ...ref, citationIds: [] },
      { ...ref, citationIds: [citation.id, citation.id] },
    ];
    for (const attachment of invalid) {
      expect(
        buildKnowledgeEvidenceSnapshot({ ...input, attachments: [attachment] }),
      ).toMatchObject({ success: false, error: { code: 'EVIDENCE_INVALID' } });
    }
    expect(
      buildKnowledgeEvidenceSnapshot({
        ...input,
        entries: [{ ...entry, status: 'draft', savedBy: null }],
        attachments: [ref],
      }),
    ).toMatchObject({ success: false, error: { code: 'EVIDENCE_INVALID' } });
  });

  it('should prioritize explicit attachments over related candidates', () => {
    const related = Array.from({ length: 3 }, (_, index) => ({
      ...entry,
      id: id(60 + index),
    }));
    const result = buildKnowledgeEvidenceSnapshot({
      ...input,
      entries: [...related, entry],
      attachments: [ref],
    });
    expect(result).toMatchObject({
      success: true,
      data: {
        entries: expect.arrayContaining([
          expect.objectContaining({ entryId: entry.id }),
        ]),
      },
    });
  });

  it('should preserve structured and page locator metadata and prefer requested citation identities', () => {
    const structured = {
      ...citation,
      id: id(70),
      locator: {
        kind: 'structured' as const,
        id: id(71),
        sourceId: id(12),
        sourceVersionId: id(13),
        provider: 'museum',
        objectId: 'vase-1',
        fieldPath: '/materials',
        valueHash: 'd'.repeat(64),
        url: 'https://museum.example/object',
        retrievedAt: now,
        excerpt: originalText,
      },
    };
    const page = {
      ...citation,
      id: id(72),
      source: {
        ...citation.source,
        canonicalUrl: 'https://museum.example/book',
      },
      locator: {
        kind: 'page' as const,
        id: id(73),
        sourceId: id(12),
        sourceVersionId: id(13),
        pageId: id(74),
        pageIndex: 4,
        printedPageLabel: 'iv',
        excerpt: originalText,
      },
    };
    const content = {
      ...entry.content,
      citations: [citation, structured, page],
      claims: [
        { ...claim, citationIds: [citation.id, structured.id, page.id] },
      ],
    };
    const result = snapshot([{ ...entry, content }]);
    expect(result.entries[0]?.claims[0]?.citations).toMatchObject([
      { sourcePageUrl: 'https://museum.example/object', section: 'Materials' },
      { provider: 'museum', objectId: 'vase-1', fieldPath: '/materials' },
      { pageLabel: 'iv', sourcePageUrl: 'https://museum.example/book' },
    ]);
    const selected = buildKnowledgeEvidenceSnapshot({
      ...input,
      entries: [{ ...entry, content }],
      attachments: [{ ...ref, citationIds: [page.id] }],
    });
    expect(selected).toMatchObject({
      success: true,
      data: {
        entries: [{ claims: [{ citations: [{ citationId: page.id }] }] }],
      },
    });
    const unlabeled = {
      ...page,
      source: citation.source,
      locator: { ...page.locator, printedPageLabel: null },
    };
    expect(
      snapshot([{ ...entry, content: { ...content, citations: [unlabeled] } }])
        .entries[0]?.claims[0]?.citations,
    ).toMatchObject([{ pageLabel: '5' }]);
  });

  it('should reject mismatched source-version authority and preserve a claim without optional uncertainty', () => {
    if (citation.locator.kind !== 'web') {
      throw new Error('Expected web citation fixture');
    }
    const { section: _section, ...unsectioned } = citation.locator;
    expect(
      snapshot([
        {
          ...entry,
          content: {
            ...entry.content,
            citations: [{ ...citation, locator: unsectioned }],
          },
        },
      ]).entries[0]?.claims[0]?.citations[0],
    ).not.toHaveProperty('section');
    const { uncertainty: _uncertainty, ...certain } = claim;
    expect(
      snapshot([{ ...entry, content: { ...entry.content, claims: [certain] } }])
        .entries[0]?.claims[0],
    ).not.toHaveProperty('uncertainty');
    for (const locator of [
      { ...citation.locator, sourceId: id(90) },
      { ...citation.locator, sourceVersionId: id(90) },
    ]) {
      expect(
        snapshot([
          {
            ...entry,
            content: {
              ...entry.content,
              citations: [{ ...citation, locator }],
            },
          },
        ]).entries,
      ).toEqual([]);
    }
  });

  it('should hash canonical semantic content independently of object insertion order and random snapshot identity', () => {
    const first = snapshot([
      withClaim({ scope: { material: ['porcelain'], object: ['vase'] } }),
    ]);
    const second = buildKnowledgeEvidenceSnapshot({
      ...input,
      snapshotId: id(32),
      entries: [
        withClaim({ scope: { object: ['vase'], material: ['porcelain'] } }),
      ],
    });
    expect(second).toMatchObject({
      success: true,
      data: { snapshotId: id(32), snapshotHash: first.snapshotHash },
    });
    expect(
      snapshot([withClaim({ uncertainty: 'Different uncertainty' })])
        .snapshotHash,
    ).not.toBe(first.snapshotHash);
    const canonical = (value: unknown): unknown =>
      Array.isArray(value)
        ? value.map(canonical)
        : value !== null && typeof value === 'object'
          ? Object.fromEntries(
              Object.entries(value)
                .sort(([left], [right]) => left.localeCompare(right))
                .map(([key, nested]) => [key, canonical(nested)]),
            )
          : value;
    const {
      snapshotId: _snapshotId,
      snapshotHash: _snapshotHash,
      ...semantic
    } = first;
    expect(first.snapshotHash).toBe(
      createHash('sha256')
        .update(JSON.stringify(canonical(semantic)))
        .digest('hex'),
    );
  });
});

describe('fn:validateKnowledgeAnswerSegments', () => {
  it('should admit only exact pinned references with nonempty unique citation identities', () => {
    const frozen = snapshot();
    const segment: AnswerSegment = {
      text: 'A museum observation, with uncertainty.',
      evidenceRefs: [ref],
    };
    expect(validateKnowledgeAnswerSegments([segment], frozen)).toBe(true);
    expect(validateKnowledgeAnswerSegments([], frozen)).toBe(false);
    expect(
      validateKnowledgeAnswerSegments(
        Array.from({ length: 33 }, () => segment),
        frozen,
      ),
    ).toBe(false);
    expect(
      validateKnowledgeAnswerSegments(
        [{ ...segment, text: 'x'.repeat(4_001) }],
        frozen,
      ),
    ).toBe(false);
    expect(
      validateKnowledgeAnswerSegments([{ ...segment, text: '' }], frozen),
    ).toBe(false);
    expect(
      validateKnowledgeAnswerSegments(
        [{ text: 'No supporting evidence.', evidenceRefs: [] }],
        frozen,
      ),
    ).toBe(true);
    for (const reference of [
      { ...ref, entryId: id(90) },
      { ...ref, revision: 2 },
      { ...ref, claimKey: 'other' },
      { ...ref, citationIds: [id(90)] },
      { ...ref, citationIds: [] },
      { ...ref, citationIds: [citation.id, citation.id] },
    ]) {
      expect(
        validateKnowledgeAnswerSegments(
          [{ ...segment, evidenceRefs: [reference] }],
          frozen,
        ),
      ).toBe(false);
    }
  });
});

const related: RelatedKnowledgePage = {
  recordRevision: 2,
  contextHash: 'c'.repeat(64),
  cards: [],
  reason: 'no_match',
};

function reader(
  detail: KnowledgeEntryDetailV2 | null = entry,
): KnowledgeEvidenceReader {
  return {
    related: vi.fn(async () => related),
    getV2: vi.fn(async () => detail),
    getCorpusGeneration: vi.fn(async () => input.corpusGeneration),
  };
}

describe('fn:freezeKnowledgeEvidence', () => {
  it('should pin the attachment revision and resolve related evidence only once', async () => {
    const source = reader();
    const result = await freezeKnowledgeEvidence(
      source,
      { id: input.recordId, recordRevision: 2 },
      [ref],
      input.snapshotId,
    );
    expect(result).toMatchObject({
      success: true,
      data: { entries: [{ entryId: entry.id, revision: 1 }] },
    });
    expect(source.related).toHaveBeenCalledTimes(1);
    expect(source.getCorpusGeneration).toHaveBeenCalledTimes(1);
    expect(source.getV2).toHaveBeenCalledWith(
      entry.id,
      expect.objectContaining({ view: 'revision', revision: 1 }),
    );
  });

  it('should revalidate exact related revisions and omit unavailable candidates', async () => {
    const card = {
      entryId: entry.id,
      revision: 1,
      title: 'Museum object',
      language: 'en',
      fallback: true,
      kind: 'object_example' as const,
      category: [],
      matches: [
        {
          field: 'name' as const,
          value: 'vase',
          topicId: null,
          label: 'vase',
          matchedTokens: ['vase'],
        },
      ],
      excerpt: null,
      providers: [],
    };
    const source = {
      ...reader(),
      related: vi.fn(async () => ({ ...related, cards: [card] })),
    };
    const result = await freezeKnowledgeEvidence(
      source,
      { id: input.recordId, recordRevision: 2 },
      [ref],
      input.snapshotId,
    );
    expect(result).toMatchObject({
      success: true,
      data: { entries: [{ entryId: entry.id, revision: 1 }] },
    });
    expect(source.getV2).toHaveBeenCalledExactlyOnceWith(
      entry.id,
      expect.objectContaining({ view: 'revision', revision: 1 }),
    );
    expect(
      await freezeKnowledgeEvidence(
        { ...source, getV2: async () => null },
        { id: input.recordId, recordRevision: 2 },
        [],
        input.snapshotId,
      ),
    ).toMatchObject({ success: true, data: { entries: [] } });
  });

  it('should reject inaccessible and unsaved attachments without substituting current evidence', async () => {
    for (const detail of [
      null,
      { ...entry, status: 'draft' as const, savedBy: null },
    ]) {
      expect(
        await freezeKnowledgeEvidence(
          reader(detail),
          { id: input.recordId, recordRevision: 2 },
          [ref],
          input.snapshotId,
        ),
      ).toMatchObject({ success: false, error: { code: 'EVIDENCE_INVALID' } });
    }
  });

  it('should reject absent records and revision changes before generating evidence', async () => {
    expect(
      await freezeKnowledgeEvidence(
        { ...reader(), related: async () => null },
        { id: input.recordId, recordRevision: 2 },
        [],
        input.snapshotId,
      ),
    ).toMatchObject({ success: false, error: { code: 'NOT_FOUND' } });
    expect(
      await freezeKnowledgeEvidence(
        {
          ...reader(),
          related: async () => ({ ...related, recordRevision: 3 }),
        },
        { id: input.recordId, recordRevision: 2 },
        [],
        input.snapshotId,
      ),
    ).toMatchObject({ success: false, error: { code: 'REVISION_CONFLICT' } });
  });
});
