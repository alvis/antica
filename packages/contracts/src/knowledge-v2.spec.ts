import { describe, expect, it } from 'vitest';

import {
  knowledgeReadV2Schema,
  knowledgeUpdateV2Schema,
  knowledgeWriteV2Schema,
} from './knowledge-v2-operations.js';
import {
  knowledgeContentEnvelopeV2Schema,
  knowledgeLocatorV2Schema,
  knowledgeImageV2Schema,
  knowledgeClaimV2Schema,
  citedTextV2Schema,
} from './knowledge-v2.js';

const envelope = {
  contentSchemaVersion: 2,
  entryType: 'concept',
  origin: 'collector',
  titles: [{ language: 'zh-Hant', text: 'Porcelain body' }],
  aliases: [],
  sections: {
    summary: {
      claimKey: 'body',
      text: 'A body observation',
      citationIds: [],
      supportState: 'needs_source',
    },
    history: [],
    features: [],
    applicability: [],
    limits: [],
  },
  claims: [
    {
      claimKey: 'body',
      section: 'summary',
      ordinal: 0,
      originalText: 'A body observation',
      originalLanguage: 'zh-Hant',
      statementType: 'observation',
      scope: {},
      qualifiers: {},
      supportState: 'needs_source',
      citationIds: [],
      review: { state: 'pending' },
      variants: [],
    },
  ],
  topics: [],
  citations: [],
  images: [],
  methodIds: [],
  relatedEntryIds: [],
  editorialReview: { state: 'pending' },
};

describe('fn:knowledgeContentEnvelopeV2Schema', () => {
  it('should retain an original-script draft without asserting support or review', () => {
    expect(knowledgeContentEnvelopeV2Schema.parse(envelope)).toEqual(envelope);
  });

  it('should reject invalid content language, unbounded text, and unknown envelope fields', () => {
    expect(
      knowledgeContentEnvelopeV2Schema.safeParse({
        ...envelope,
        titles: [{ language: 'invalid_tag', text: 'Title' }],
      }).success,
    ).toBe(false);
    expect(
      knowledgeContentEnvelopeV2Schema.safeParse({
        ...envelope,
        titles: [{ language: 'en', text: 'x'.repeat(100_001) }],
      }).success,
    ).toBe(false);
    expect(
      knowledgeContentEnvelopeV2Schema.safeParse({
        ...envelope,
        savedBy: 'collector',
      }).success,
    ).toBe(false);
  });

  it('should require the cited-text node to identify its granular claim', () => {
    expect(
      knowledgeContentEnvelopeV2Schema.safeParse({
        ...envelope,
        sections: {
          ...envelope.sections,
          summary: {
            text: 'A body observation',
            citationIds: [],
            supportState: 'needs_source',
          },
        },
      }).success,
    ).toBe(false);
  });
});

describe('fn:knowledgeWriteV2Schema', () => {
  const command = {
    requestKey: '00000000-0000-4000-8000-000000000001',
    expectedRevision: null,
    status: 'draft',
    content: envelope,
    reviewDecisions: [],
    translationDecisions: [],
  };
  it('should accept explicit draft and saved actions and require optimistic revision checks on updates', () => {
    expect(knowledgeWriteV2Schema.parse(command)).toEqual(command);
    expect(
      knowledgeWriteV2Schema.safeParse({ ...command, status: 'saved' }).success,
    ).toBe(true);
    expect(
      knowledgeUpdateV2Schema.safeParse({ ...command, expectedRevision: 1 })
        .success,
    ).toBe(true);
    expect(knowledgeUpdateV2Schema.safeParse(command).success).toBe(false);
  });
  it('should reject client-provided save provenance and review actor identities', () => {
    expect(
      knowledgeWriteV2Schema.safeParse({ ...command, savedBy: 'collector' })
        .success,
    ).toBe(false);
    expect(
      knowledgeWriteV2Schema.safeParse({
        ...command,
        reviewDecisions: [
          { claimKey: 'body', state: 'reviewed', actor: 'forged' },
        ],
      }).success,
    ).toBe(false);
    expect(
      knowledgeWriteV2Schema.safeParse({
        ...command,
        content: {
          ...envelope,
          editorialReview: {
            state: 'reviewed',
            actor: 'forged',
            at: '2026-10-19T00:00:00.000Z',
          },
        },
      }).success,
    ).toBe(false);
  });
});

describe('fn:knowledgeReadV2Schema', () => {
  it('should require an exact revision only for historical view and accept working and saved reads', () => {
    expect(knowledgeReadV2Schema.safeParse({}).success).toBe(true);
    expect(
      knowledgeReadV2Schema.safeParse({ view: 'saved', locale: 'en' }).success,
    ).toBe(true);
    expect(knowledgeReadV2Schema.safeParse({ view: 'working' }).success).toBe(
      true,
    );
    expect(
      knowledgeReadV2Schema.safeParse({ view: 'revision', revision: 2 })
        .success,
    ).toBe(true);
    expect(knowledgeReadV2Schema.safeParse({ view: 'revision' }).success).toBe(
      false,
    );
    expect(
      knowledgeReadV2Schema.safeParse({ view: 'saved', revision: 2 }).success,
    ).toBe(false);
    expect(knowledgeReadV2Schema.safeParse({ revision: 2 }).success).toBe(true);
  });
});

describe('fn:knowledgeClaimV2Schema', () => {
  it('should require server provenance for completed reviews and reject provenance on pending reviews', () => {
    const claim = envelope.claims[0]!;
    expect(
      knowledgeClaimV2Schema.safeParse({
        ...claim,
        review: {
          state: 'reviewed',
          actor: 'collector',
          at: '2026-10-19T00:00:00.000Z',
        },
      }).success,
    ).toBe(true);
    expect(
      knowledgeClaimV2Schema.safeParse({
        ...claim,
        review: { state: 'reviewed' },
      }).success,
    ).toBe(false);
    expect(
      knowledgeClaimV2Schema.safeParse({
        ...claim,
        review: { state: 'reviewed', actor: 'collector' },
      }).success,
    ).toBe(false);
    expect(
      knowledgeClaimV2Schema.safeParse({
        ...claim,
        review: { state: 'pending', actor: 'collector' },
      }).success,
    ).toBe(false);
    expect(
      knowledgeClaimV2Schema.safeParse({
        ...claim,
        review: { state: 'pending', at: '2026-10-19T00:00:00.000Z' },
      }).success,
    ).toBe(false);
    expect(
      citedTextV2Schema.safeParse({
        claimKey: 'body',
        text: 'Statement',
        supportState: 'cited',
        citationIds: [],
      }).success,
    ).toBe(false);
    expect(
      citedTextV2Schema.safeParse({
        claimKey: 'body',
        text: 'Statement',
        supportState: 'cited',
        citationIds: ['00000000-0000-4000-8000-000000000001'],
      }).success,
    ).toBe(true);
  });
});

describe('fn:knowledgeLocatorV2Schema', () => {
  const locator = {
    kind: 'structured',
    id: '00000000-0000-4000-8000-000000000001',
    sourceId: '00000000-0000-4000-8000-000000000002',
    sourceVersionId: '00000000-0000-4000-8000-000000000003',
    provider: 'museum',
    objectId: '1',
    fieldPath: '/fields/a~1b/~0name',
    valueHash: 'a'.repeat(64),
    url: 'https://museum.example/1',
    retrievedAt: '2026-10-19T00:00:00.000Z',
    excerpt: 'Vase',
  };
  it('should accept RFC 6901 escaping and root pointers while rejecting malformed pointers and unsafe URLs', () => {
    expect(knowledgeLocatorV2Schema.safeParse(locator).success).toBe(true);
    expect(
      knowledgeLocatorV2Schema.safeParse({ ...locator, fieldPath: '' }).success,
    ).toBe(true);
    expect(
      knowledgeLocatorV2Schema.safeParse({
        ...locator,
        fieldPath: 'fields/title',
      }).success,
    ).toBe(false);
    expect(
      knowledgeLocatorV2Schema.safeParse({
        ...locator,
        fieldPath: '/field~2bad',
      }).success,
    ).toBe(false);
    expect(
      knowledgeLocatorV2Schema.safeParse({
        ...locator,
        url: 'http://museum.example/1',
      }).success,
    ).toBe(true);
    expect(
      knowledgeLocatorV2Schema.safeParse({ ...locator, url: 'file:///tmp/a' })
        .success,
    ).toBe(false);
  });
  it('should keep the source page separate from image URL and allow unknown observed rights', () => {
    const image = {
      id: locator.id,
      sourceVersionId: locator.sourceVersionId,
      imageUrl: 'https://images.example/large.jpg',
      sourcePageUrl: locator.url,
      provider: 'museum',
      status: 'unchecked',
    };
    expect(knowledgeImageV2Schema.parse(image)).toEqual(image);
    expect(
      knowledgeContentEnvelopeV2Schema.safeParse({
        ...envelope,
        images: [image],
      }).success,
    ).toBe(true);
    expect(
      knowledgeImageV2Schema.safeParse({
        ...image,
        imageUrl: 'data:image/png;base64,AAAA',
      }).success,
    ).toBe(false);
  });
});

describe('fn:knowledgeContentEnvelopeV2Schema consistency', () => {
  it('should reject missing, duplicated, misplaced and mismatched granular claim nodes', () => {
    const claim = envelope.claims[0]!;
    const id = '00000000-0000-4000-8000-000000000001';
    for (const invalid of [
      { ...envelope, claims: [claim, claim] },
      { ...envelope, claims: [{ ...claim, claimKey: 'absent' }] },
      { ...envelope, claims: [{ ...claim, section: 'history' }] },
      { ...envelope, claims: [{ ...claim, ordinal: 1 }] },
      { ...envelope, claims: [{ ...claim, supportState: 'cited' }] },
      {
        ...envelope,
        claims: [{ ...claim, originalText: 'Different original' }],
      },
      { ...envelope, claims: [{ ...claim, citationIds: [id] }] },
      { ...envelope, methodIds: [id, id] },
      {
        ...envelope,
        topics: [
          { topicId: id, applicability: 'general' },
          { topicId: id, applicability: 'general' },
        ],
      },
    ]) {
      expect(knowledgeContentEnvelopeV2Schema.safeParse(invalid).success).toBe(
        false,
      );
    }
  });

  it('should retain independently positioned sections and reject forged or duplicated original language variants', () => {
    const claim = envelope.claims[0]!;
    const node = envelope.sections.summary;
    const original = {
      language: 'zh-Hant',
      kind: 'original',
      text: claim.originalText,
      method: 'original',
      sourceTextHash: 'a'.repeat(64),
      review: { state: 'pending' },
    };
    const valid = {
      ...envelope,
      sections: {
        ...envelope.sections,
        history: [{ ...node, claimKey: 'history' }],
        features: [{ ...node, claimKey: 'features' }],
        applicability: [{ ...node, claimKey: 'applicability' }],
        limits: [{ ...node, claimKey: 'limits' }],
      },
      claims: [
        claim,
        ...['history', 'features', 'applicability', 'limits'].map(
          (section) => ({
            ...claim,
            claimKey: section,
            section,
            variants: [original],
          }),
        ),
      ],
    };
    expect(knowledgeContentEnvelopeV2Schema.safeParse(valid).success).toBe(
      true,
    );
    for (const variants of [
      [original, original],
      [{ ...original, language: 'en' }],
      [{ ...original, text: 'Forged original' }],
      [{ ...original, method: 'human' }],
    ]) {
      expect(
        knowledgeContentEnvelopeV2Schema.safeParse({
          ...envelope,
          claims: [{ ...claim, variants }],
        }).success,
      ).toBe(false);
    }
  });
});
