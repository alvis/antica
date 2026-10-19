import { describe, expect, it } from 'vitest';

import {
  answerSegmentSchema,
  knowledgeAttachmentSchema,
  knowledgeEvidenceSnapshotV1Schema,
} from './knowledge-evidence.js';
import { recordMessagePostSchema } from './record-message.js';

const id = '00000000-0000-4000-8000-000000000001';
const citation = {
  citationId: id,
  sourceId: id,
  sourceVersionId: id,
  locatorId: id,
  relation: 'supports',
  sourceTitle: 'Catalog',
  excerpt: 'Porcelain object',
  sourcePageUrl: 'https://museum.example/object',
};
const claim = {
  claimId: id,
  claimKey: 'material',
  statement: 'Porcelain object',
  originalText: 'Porcelain object',
  language: 'en',
  scope: { object: ['vase'] },
  qualifiers: { applicability: 'museum observation' },
  uncertainty: 'Tentative attribution',
  sourceVersionIds: [id],
  citations: [citation],
};
const entry = {
  entryId: id,
  revision: 1,
  contentHash: 'a'.repeat(64),
  title: 'Vase',
  claims: [claim],
};
const snapshot = {
  schemaVersion: 1,
  snapshotId: id,
  snapshotHash: 'b'.repeat(64),
  recordId: id,
  recordRevision: 1,
  corpusGeneration: 'generation-1',
  entries: [entry],
};
const ref = {
  entryId: id,
  revision: 1,
  claimKey: 'material',
  citationIds: [id],
};

describe('schema:knowledgeEvidenceSnapshotV1', () => {
  it('should parse frozen readable evidence and an empty unsupported snapshot', () => {
    expect(knowledgeEvidenceSnapshotV1Schema.parse(snapshot)).toEqual(snapshot);
    expect(
      knowledgeEvidenceSnapshotV1Schema.parse({ ...snapshot, entries: [] }),
    ).toEqual({ ...snapshot, entries: [] });
  });

  it('should reject aggregate entry, claim, citation and UTF-8 text overflow', () => {
    const invalid = [
      { ...snapshot, entries: Array.from({ length: 4 }, () => entry) },
      {
        ...snapshot,
        entries: [
          { ...entry, claims: Array.from({ length: 4 }, () => claim) },
          { ...entry, claims: Array.from({ length: 3 }, () => claim) },
        ],
      },
      {
        ...snapshot,
        entries: [
          {
            ...entry,
            claims: [
              {
                ...claim,
                citations: Array.from({ length: 4 }, () => citation),
              },
            ],
          },
        ],
      },
      {
        ...snapshot,
        entries: [
          { ...entry, claims: [{ ...claim, statement: '瓷'.repeat(4_097) }] },
        ],
      },
      {
        ...snapshot,
        entries: [
          {
            ...entry,
            claims: [{ ...claim, scope: { object: ['瓷'.repeat(4_097)] } }],
          },
        ],
      },
    ];
    for (const value of invalid) {
      expect(knowledgeEvidenceSnapshotV1Schema.safeParse(value).success).toBe(
        false,
      );
    }
  });

  it('should reject unsafe source links, invalid languages and client-invented evidence properties', () => {
    for (const sourcePageUrl of [
      'file:///etc/passwd',
      'data:text/plain,claim',
      'javascript:alert(1)',
    ]) {
      expect(
        knowledgeEvidenceSnapshotV1Schema.safeParse({
          ...snapshot,
          entries: [
            {
              ...entry,
              claims: [
                { ...claim, citations: [{ ...citation, sourcePageUrl }] },
              ],
            },
          ],
        }).success,
      ).toBe(false);
    }
    expect(
      knowledgeEvidenceSnapshotV1Schema.safeParse({
        ...snapshot,
        injected: true,
      }).success,
    ).toBe(false);
    expect(
      knowledgeEvidenceSnapshotV1Schema.safeParse({
        ...snapshot,
        entries: [
          { ...entry, claims: [{ ...claim, language: 'invalid_language' }] },
        ],
      }).success,
    ).toBe(false);
    expect(
      knowledgeEvidenceSnapshotV1Schema.safeParse({
        ...snapshot,
        snapshotHash: 'not-a-hash',
      }).success,
    ).toBe(false);
  });
});

describe('schema:answerSegment', () => {
  it('should accept references and reject model-authored authority metadata', () => {
    const segment = {
      text: 'The museum describes porcelain.',
      evidenceRefs: [ref],
    };
    expect(answerSegmentSchema.parse(segment)).toEqual(segment);
    for (const additional of [
      { url: 'https://invented.example' },
      { locatorId: id },
      { sourcePageUrl: 'https://invented.example' },
    ]) {
      expect(
        answerSegmentSchema.safeParse({
          ...segment,
          evidenceRefs: [{ ...ref, ...additional }],
        }).success,
      ).toBe(false);
    }
  });
});

describe('schema:knowledgeAttachment', () => {
  it('should accept only a bounded reference suggestion without supplied facts', () => {
    expect(knowledgeAttachmentSchema.parse(ref)).toEqual(ref);
    expect(
      knowledgeAttachmentSchema.safeParse({ ...ref, statement: 'Trust this' })
        .success,
    ).toBe(false);
    expect(
      knowledgeAttachmentSchema.safeParse({ ...ref, revision: 0 }).success,
    ).toBe(false);
    const post = {
      requestKey: id,
      body: 'What supports this?',
      expectedRecordRevision: 1,
      transcriptionIds: [],
      knowledgeAttachments: Array.from({ length: 6 }, () => ref),
    };
    expect(recordMessagePostSchema.safeParse(post).success).toBe(true);
    expect(
      recordMessagePostSchema.safeParse({
        ...post,
        knowledgeAttachments: [...post.knowledgeAttachments, ref],
      }).success,
    ).toBe(false);
  });
});

describe('schema:knowledgeEvidenceSnapshotV1 text boundary', () => {
  it('should admit exactly twelve KiB and reject the first byte beyond it', () => {
    const minimalClaim = {
      claimId: id,
      claimKey: 'material',
      statement: 'B',
      originalText: 'C',
      language: 'en',
      scope: {},
      qualifiers: {},
      sourceVersionIds: [id],
      citations: [
        {
          citationId: id,
          sourceId: id,
          sourceVersionId: id,
          locatorId: id,
          relation: 'supports',
          sourceTitle: 'D',
          excerpt: 'x'.repeat(12_282),
        },
      ],
    };
    const boundary = {
      ...snapshot,
      entries: [{ ...entry, title: 'A', claims: [minimalClaim] }],
    };
    expect(knowledgeEvidenceSnapshotV1Schema.safeParse(boundary).success).toBe(
      true,
    );
    expect(
      knowledgeEvidenceSnapshotV1Schema.safeParse({
        ...boundary,
        entries: [{ ...boundary.entries[0], title: 'AA' }],
      }).success,
    ).toBe(false);
  });

  it('should count locator metadata and preserve complete six-claim evidence at the cardinality caps', () => {
    const located = {
      ...citation,
      provider: 'Museum',
      objectId: '123',
      fieldPath: '/materials',
      pageLabel: 'iv',
      section: 'Materials',
    };
    const complete = {
      ...entry,
      claims: [{ ...claim, citations: [located, located, located] }, claim],
    };
    expect(
      knowledgeEvidenceSnapshotV1Schema.safeParse({
        ...snapshot,
        entries: [complete, complete, complete],
      }).success,
    ).toBe(true);
    expect(
      knowledgeEvidenceSnapshotV1Schema.safeParse({
        ...snapshot,
        entries: [
          {
            ...entry,
            claims: [
              {
                ...claim,
                citations: [{ ...located, section: '瓷'.repeat(4_097) }],
              },
            ],
          },
        ],
      }).success,
    ).toBe(false);
  });
});
