import { describe, expect, it } from 'vitest';

import { projectKnowledge } from './projections.js';

import type { KnowledgeContentEnvelopeV2 } from '@antica/contracts';

const content: KnowledgeContentEnvelopeV2 = {
  contentSchemaVersion: 2,
  entryType: 'concept',
  origin: 'collector',
  titles: [{ language: 'en', text: 'Vase' }],
  aliases: [],
  sections: {
    summary: {
      claimKey: 'body',
      text: 'Body',
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
      originalText: 'Body',
      originalLanguage: 'en',
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
const instant = '2026-10-19T00:00:00.000Z';

describe('fn:projectKnowledge', () => {
  it('should derive a stable original variant and null absent review metadata from the envelope', () => {
    const rows = projectKnowledge(
      { ownerId: 'owner', entryId: 'entry', revision: 1 },
      content,
    );
    expect(rows).toEqual(
      projectKnowledge(
        { ownerId: 'owner', entryId: 'entry', revision: 1 },
        content,
      ),
    );
    expect(rows.claims).toMatchObject([
      {
        claimKey: 'body',
        uncertainty: null,
        reviewedBy: null,
        reviewedAt: null,
      },
    ]);
    expect(rows.variants).toMatchObject([
      {
        kind: 'original',
        language: 'en',
        text: 'Body',
        method: 'original',
        translator: null,
        translatedAt: null,
        reviewedBy: null,
        reviewedAt: null,
      },
    ]);
    expect(rows.citations).toEqual([]);
    expect(rows.topics).toEqual([]);
    expect(
      projectKnowledge(
        { ownerId: 'owner', entryId: 'entry', revision: 2 },
        content,
      ).claims[0]!.id,
    ).not.toBe(rows.claims[0]!.id);
  });

  it('should project independently reviewed translations, citation links and specific topic uncertainty', () => {
    const rows = projectKnowledge(
      { ownerId: 'owner', entryId: 'entry', revision: 1 },
      {
        ...content,
        claims: [
          {
            ...content.claims[0]!,
            uncertainty: 'Uncertain attribution',
            citationIds: ['citation'],
            review: { state: 'reviewed', actor: 'collector', at: instant },
            variants: [
              {
                kind: 'translation',
                language: 'zh-Hant',
                text: '胎體',
                method: 'human',
                translator: 'translator',
                translatedAt: instant,
                sourceTextHash: 'a'.repeat(64),
                review: { state: 'reviewed', actor: 'collector', at: instant },
              },
            ],
          },
        ],
        topics: [
          {
            topicId: 'topic',
            applicability: 'specific',
            uncertainty: 'Possibly associated',
          },
          { topicId: 'general', applicability: 'general' },
        ],
      },
    );
    expect(rows.claims).toMatchObject([
      {
        uncertainty: 'Uncertain attribution',
        reviewedBy: 'collector',
        reviewedAt: new Date(instant),
      },
    ]);
    expect(rows.citations).toEqual([
      { claimId: rows.claims[0]!.id, citationId: 'citation' },
    ]);
    expect(rows.variants).toMatchObject([
      { kind: 'original' },
      {
        language: 'zh-Hant',
        kind: 'translation',
        translator: 'translator',
        translatedAt: new Date(instant),
        reviewedBy: 'collector',
        reviewedAt: new Date(instant),
      },
    ]);
    expect(rows.topics).toEqual([
      {
        ownerId: 'owner',
        entryId: 'entry',
        revision: 1,
        topicId: 'topic',
        applicability: 'specific',
        uncertainty: 'Possibly associated',
      },
      {
        ownerId: 'owner',
        entryId: 'entry',
        revision: 1,
        topicId: 'general',
        applicability: 'general',
        uncertainty: null,
      },
    ]);
  });

  it('should preserve an explicitly supplied original variant without duplicating it', () => {
    const rows = projectKnowledge(
      { ownerId: 'owner', entryId: 'entry', revision: 1 },
      {
        ...content,
        claims: [
          {
            ...content.claims[0]!,
            variants: [
              {
                kind: 'original',
                language: 'en',
                text: 'Body',
                method: 'original',
                sourceTextHash: 'a'.repeat(64),
                review: { state: 'pending' },
              },
            ],
          },
        ],
      },
    );
    expect(rows.variants).toHaveLength(1);
    expect(rows.variants[0]).toMatchObject({
      kind: 'original',
      translator: null,
      translatedAt: null,
    });
  });
});
