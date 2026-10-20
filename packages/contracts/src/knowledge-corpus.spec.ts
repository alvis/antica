import { describe, expect, it } from 'vitest';

import {
  corpusFileSchema,
  filterGuideStatementsForRecord,
} from './knowledge-corpus.js';

import type {
  CorpusExaminationGuide,
  CorpusGuideStatement,
  CorpusSource,
} from './knowledge-corpus.js';

const citation: CorpusSource['citations'][number] = {
  id: 'antica:citation:foot',
  sourceContentId: 'antica:source:book',
  payloadHash: 'a'.repeat(64),
  locatorId: 'antica:locator:foot',
  relation: 'supports',
  quote: 'Look at the foot.\nDo not infer authenticity.',
};
const statement: CorpusGuideStatement = {
  field: 'what',
  claimKey: 'foot-observation',
  ordinal: 0,
  originalText: citation.quote,
  originalLanguage: 'en',
  statementType: 'observation',
  scope: {},
  qualifiers: {},
  supportState: 'cited',
  citationIds: [citation.id],
  review: { state: 'pending' },
  variants: [
    {
      language: 'en',
      kind: 'original',
      text: citation.quote,
      method: 'original',
      sourceTextHash: 'b'.repeat(64),
      review: { state: 'pending' },
    },
  ],
};
const guide: CorpusExaminationGuide = {
  formatVersion: 1,
  kind: 'examination_guide',
  id: 'antica:guide:foot',
  guideVersion: 1,
  category: 'ceramics',
  titles: [
    { language: 'zh-Hant', text: '足圈', kind: 'preferred' },
    { language: 'en', text: 'Foot ring', kind: 'preferred' },
  ],
  appliesToTopicIds: ['antica:topic:ceramics'],
  framing: 'observation_not_verdict',
  externalObjectIds: [citation.sourceContentId],
  editorialReview: { state: 'pending' },
  checks: [
    {
      checkKey: 'foot',
      group: 'base_marks',
      ordinal: 0,
      labels: [
        { language: 'zh-Hant', text: '足圈', kind: 'preferred' },
        { language: 'en', text: 'Foot', kind: 'preferred' },
      ],
      statements: [statement],
      imageIds: [],
      relatedEntryIds: [],
      gap: {
        fields: ['why', 'howToSee', 'typical', 'warningSigns'],
        need: 'Find evidence.',
      },
    },
  ],
};

describe('examination guide parsing', () => {
  it('should preserve original bytes and opinion flags when parsing a guide', () => {
    const input = {
      ...guide,
      checks: [
        {
          ...guide.checks[0]!,
          statements: [
            { ...statement, attributedOpinion: true, verdictLanguage: true },
          ],
        },
      ],
    };

    expect(corpusFileSchema.parse(input)).toEqual(input);
  });

  it.each([
    { ...guide, guideVersion: 0 },
    { ...guide, framing: 'authenticity_verdict' },
    { ...guide, checks: [{ ...guide.checks[0]!, checkKey: '' }] },
    { ...guide, checks: [{ ...guide.checks[0]!, checkKey: 'x'.repeat(201) }] },
    { ...guide, checks: [{ ...guide.checks[0]!, ordinal: -1 }] },
    { ...guide, checks: [{ ...guide.checks[0]!, group: 'score' }] },
    { ...guide, checks: [{ ...guide.checks[0]!, score: 100 }] },
    {
      ...guide,
      checks: [
        {
          ...guide.checks[0]!,
          statements: [{ ...statement, field: 'verdict' }],
        },
      ],
    },
    {
      ...guide,
      checks: [
        {
          ...guide.checks[0]!,
          statements: [{ ...statement, verdictLanguage: 'yes' }],
        },
      ],
    },
  ])('should reject malformed or machine-verdict guide input %#', (input) => {
    expect(corpusFileSchema.safeParse(input).success).toBe(false);
  });
});

describe('fn:filterGuideStatementsForRecord', () => {
  it('should retain supported observations in input order without changing original text', () => {
    const later = {
      ...statement,
      claimKey: 'later',
      attributedOpinion: false,
      verdictLanguage: false,
    };
    const before = structuredClone([later, statement]);
    const input = [later, statement];

    expect(filterGuideStatementsForRecord(input, [citation])).toEqual(before);
    expect(input).toEqual(before);
  });

  it.each(['attributedOpinion', 'verdictLanguage'] as const)(
    'should exclude a statement with %s even when its citation is safe',
    (flag) => {
      expect(
        filterGuideStatementsForRecord(
          [{ ...statement, claimKey: 'unsafe', [flag]: true }, statement],
          [citation],
        ),
      ).toEqual([statement]);
    },
  );

  it.each(['attributedOpinion', 'verdictLanguage'] as const)(
    'should exclude statements inheriting citation %s even when another citation is safe',
    (flag) => {
      const unsafeCitation = {
        ...citation,
        id: 'antica:citation:opinion',
        [flag]: true,
      };
      const unsafeStatement = {
        ...statement,
        claimKey: 'unsafe',
        attributedOpinion: false,
        verdictLanguage: false,
        citationIds: [citation.id, unsafeCitation.id],
      };

      expect(
        filterGuideStatementsForRecord(
          [unsafeStatement, statement],
          [citation, unsafeCitation],
        ),
      ).toEqual([statement]);
    },
  );

  it('should exclude unresolved references even when another citation resolves', () => {
    expect(
      filterGuideStatementsForRecord(
        [
          {
            ...statement,
            claimKey: 'unresolved',
            citationIds: [citation.id, 'antica:citation:missing'],
          },
          statement,
        ],
        [citation],
      ),
    ).toEqual([statement]);
  });

  it('should exclude unsourced archives and cited statements without citations', () => {
    expect(
      filterGuideStatementsForRecord(
        [
          {
            ...statement,
            claimKey: 'archive',
            supportState: 'needs_source',
            citationIds: [],
          },
          { ...statement, claimKey: 'empty-cited', citationIds: [] },
          statement,
        ],
        [citation],
      ),
    ).toEqual([statement]);
  });

  it('should return no record statements when evidence cannot resolve', () => {
    expect(filterGuideStatementsForRecord([statement], [])).toEqual([]);
  });
});
