import { describe, expect, it } from 'vitest';

import { corpusFileSchema } from '@antica/contracts';

import { canonicalJson, sha256 } from './canonical.js';
import { createCorpusFixture } from './fixtures/corpus.js';
import {
  createGuideCorpusFixture,
  createGuideFixture,
} from './fixtures/guides.js';
import { validateCorpusDocuments } from './validate.js';

import type { GuideFixture } from './fixtures/guides.js';

interface InvalidGuideCase {
  name: string;
  mutate: (fixture: GuideFixture) => void;
  file?: string;
}

const invalidGuides: InvalidGuideCase[] = [
  {
    name: 'duplicate check keys',
    mutate: ({ guide }) => {
      const check = guide.checks[0]!;
      guide.checks.push({
        ...check,
        ordinal: 1,
        statements: check.statements.map((statement) => ({
          ...statement,
          claimKey: `${statement.claimKey}-second`,
        })),
      });
    },
  },
  {
    name: 'duplicate group ordinals',
    mutate: ({ guide }) => {
      const check = guide.checks[0]!;
      guide.checks.push({
        ...check,
        checkKey: 'another-foot',
        statements: check.statements.map((statement) => ({
          ...statement,
          claimKey: `${statement.claimKey}-second`,
        })),
      });
    },
  },
  {
    name: 'reversed observation groups',
    mutate: ({ guide }) => {
      const check = guide.checks[0]!;
      guide.checks.push({
        ...check,
        checkKey: 'shape',
        group: 'form',
        statements: check.statements.map((statement) => ({
          ...statement,
          claimKey: `shape-${statement.field}`,
        })),
      });
    },
  },
  {
    name: 'descending ordinals within a group',
    mutate: ({ guide }) => {
      const check = guide.checks[0]!;
      guide.checks = [
        { ...check, ordinal: 2 },
        {
          ...check,
          ordinal: 1,
          checkKey: 'other',
          statements: check.statements.map((statement) => ({
            ...statement,
            claimKey: `other-${statement.field}`,
          })),
        },
      ];
    },
  },
  {
    name: 'claim keys reused across checks',
    mutate: ({ guide }) => {
      guide.checks.push({
        ...guide.checks[0]!,
        checkKey: 'later-foot',
        ordinal: 1,
      });
    },
  },
  {
    name: 'duplicate field ordinals',
    mutate: ({ guide }) => {
      const check = guide.checks[0]!;
      check.statements.push({
        ...check.statements[0]!,
        claimKey: 'duplicate-position',
      });
    },
  },
  {
    name: 'missing preferred Chinese title',
    mutate: ({ guide }) => {
      guide.titles = guide.titles.map((label) => ({
        ...label,
        language: 'en',
      }));
    },
  },
  {
    name: 'missing preferred English check label',
    mutate: ({ guide }) => {
      guide.checks[0]!.labels = guide.checks[0]!.labels.map((label) => ({
        ...label,
        language: 'zh-Hant',
      }));
    },
  },
  {
    name: 'unresolved topic binding',
    mutate: ({ guide }) => {
      guide.appliesToTopicIds = ['antica:topic:missing'];
    },
  },
  {
    name: 'unresolved related entry',
    mutate: ({ guide }) => {
      guide.checks[0]!.relatedEntryIds = ['antica:entry:missing'];
    },
  },
  {
    name: 'unresolved bound source',
    mutate: ({ guide }) => {
      guide.externalObjectIds.push('antica:source:missing');
    },
  },
  {
    name: 'unresolved citation',
    mutate: ({ guide }) => {
      guide.checks[0]!.statements[0]!.citationIds = ['antica:citation:missing'];
    },
  },
  {
    name: 'citation from an unbound source',
    mutate: ({ guide }) => {
      guide.externalObjectIds = [];
    },
  },
  {
    name: 'background evidence without supporting evidence',
    mutate: ({ source }) => {
      source.citations[0]!.relation = 'background';
    },
  },
  {
    name: 'comparison evidence without supporting evidence',
    mutate: ({ source }) => {
      source.citations[0]!.relation = 'comparison';
    },
  },
  {
    name: 'cited statement without evidence',
    mutate: ({ guide }) => {
      guide.checks[0]!.statements[0]!.citationIds = [];
    },
  },
  {
    name: 'unsourced archive retaining citations',
    mutate: ({ guide }) => {
      guide.checks[0]!.statements[0]!.supportState = 'needs_source';
      guide.checks[0]!.gap = { fields: ['what'], need: 'Find a source.' };
    },
  },
  {
    name: 'unsourced archive without a declared gap',
    mutate: ({ guide }) => {
      Object.assign(guide.checks[0]!.statements[0]!, {
        supportState: 'needs_source',
        citationIds: [],
      });
    },
  },
  {
    name: 'absent field without a declared gap',
    mutate: ({ guide }) => {
      guide.checks[0]!.statements.pop();
    },
  },
  {
    name: 'gap for the wrong missing field',
    mutate: ({ guide }) => {
      guide.checks[0]!.statements.pop();
      guide.checks[0]!.gap = { fields: ['what'], need: 'Find a source.' };
    },
  },
  {
    name: 'rewritten original variant',
    mutate: ({ guide }) => {
      guide.checks[0]!.statements[0]!.variants[0]!.text = 'Rewritten evidence';
    },
  },
  {
    name: 'stale translation hash',
    mutate: ({ guide }) => {
      const statement = guide.checks[0]!.statements[0]!;
      statement.variants.push({
        language: 'zh-Hant',
        kind: 'translation',
        text: '以斜光觀察足圈。',
        method: 'human',
        sourceTextHash: '0'.repeat(64),
        review: { state: 'pending' },
      });
    },
  },
  {
    name: 'unresolved image',
    mutate: ({ guide }) => {
      guide.checks[0]!.imageIds = ['antica:image:missing'];
    },
  },
  {
    name: 'image owned by an unbound source',
    mutate: ({ guide }) => {
      guide.checks[0]!.imageIds = ['antica:image:ceramics-alpha'];
    },
  },
  {
    name: 'image without explicit showability',
    mutate: ({ source }) => {
      delete source.images[0]!.showable;
    },
  },
  {
    name: 'unshowable image',
    mutate: ({ source }) => {
      source.images[0]!.showable = false;
    },
  },
  {
    name: 'image without a typical or warning role',
    mutate: ({ source }) => {
      delete source.images[0]!.role;
    },
  },
  {
    name: 'bound source without a licence basis',
    mutate: ({ source }) => {
      delete source.licenceBasis;
    },
    file: 'sources/guide/book.json',
  },
  {
    name: 'collector authorization without a note',
    mutate: ({ source }) => {
      delete source.authorizationNote;
    },
    file: 'sources/guide/book.json',
  },
  {
    name: 'collector authorization without the dated grant',
    mutate: ({ source }) => {
      source.authorizationNote =
        "I've got the authorization already. I'm making app for them. include all information you find.";
    },
    file: 'sources/guide/book.json',
  },
  {
    name: 'collector authorization without the exact grant',
    mutate: ({ source }) => {
      source.authorizationNote = '2026-10-20: permission claimed';
    },
    file: 'sources/guide/book.json',
  },
  {
    name: 'statement hiding a citation opinion flag',
    mutate: ({ source }) => {
      source.citations[0]!.attributedOpinion = true;
    },
  },
  {
    name: 'statement hiding a citation verdict flag',
    mutate: ({ source }) => {
      source.citations[0]!.verdictLanguage = true;
    },
  },
];

describe('fn:validateCorpusDocuments', () => {
  it.each([
    ['original', 'attributedOpinion'],
    ['original', 'verdictLanguage'],
    ['translation', 'attributedOpinion'],
    ['translation', 'verdictLanguage'],
    ['citation', 'attributedOpinion'],
    ['citation', 'verdictLanguage'],
  ] as const)(
    'should reject verdict wording in the %s without %s',
    (location, missingFlag) => {
      const fixture = createGuideFixture();
      const statement = fixture.guide.checks[0]!.statements[0]!;
      if (location === 'original') {
        statement.originalText = 'The author considers this genuine.';
        statement.variants[0]!.text = statement.originalText;
        statement.variants[0]!.sourceTextHash = sha256(statement.originalText);
      } else if (location === 'translation') {
        statement.variants.push({
          language: 'zh-Hant',
          kind: 'translation',
          text: '霍布森認為這是真品。',
          method: 'human',
          sourceTextHash: sha256(statement.originalText),
          review: { state: 'pending' },
        });
      } else {
        const quote = 'The author considers this fake.';
        fixture.source.payload = {
          description: quote,
          imageUrl: fixture.source.images[0]!.remoteUrl,
        };
        fixture.source.payloadHash = sha256(
          canonicalJson(fixture.source.payload),
        );
        const locator = fixture.source.locators[0]!;
        if (locator.kind !== 'structured') {
          throw new Error('Expected structured fixture locator');
        }
        locator.excerpt = quote;
        locator.valueHash = sha256(canonicalJson(quote));
        Object.assign(fixture.source.citations[0]!, {
          quote,
          payloadHash: fixture.source.payloadHash,
        });
      }
      const expectedCode =
        location === 'citation' ? 'guide_citation_verdict' : 'guide_verdict';
      const incomplete = structuredClone(fixture);
      for (const value of [
        ...incomplete.guide.checks[0]!.statements,
        ...incomplete.source.citations,
      ]) {
        Object.assign(value, {
          attributedOpinion: true,
          verdictLanguage: true,
        });
        delete value[missingFlag];
      }

      expect(
        validateCorpusDocuments(createGuideCorpusFixture(incomplete), {
          release: '1.1.0',
        }).issues,
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: expectedCode }),
        ]),
      );
      for (const value of [
        ...fixture.guide.checks[0]!.statements,
        ...fixture.source.citations,
      ]) {
        Object.assign(value, {
          attributedOpinion: true,
          verdictLanguage: true,
        });
      }
      expect(
        validateCorpusDocuments(createGuideCorpusFixture(fixture), {
          release: '1.1.0',
        }).issues,
      ).toEqual([]);
    },
  );

  it('should accept general opinion with its opinion flag alone', () => {
    const fixture = createGuideFixture();
    fixture.source.citations[0]!.attributedOpinion = true;
    for (const statement of fixture.guide.checks[0]!.statements) {
      statement.attributedOpinion = true;
    }

    expect(
      validateCorpusDocuments(createGuideCorpusFixture(fixture), {
        release: '1.1.0',
      }).issues,
    ).toEqual([]);
  });

  it('should accept complete guidance without changing entry minima or legacy parsing', () => {
    const legacy = validateCorpusDocuments(createCorpusFixture());
    const current = validateCorpusDocuments(createGuideCorpusFixture(), {
      release: '1.1.0',
    });

    expect({ legacy: legacy.issues, current: current.issues }).toEqual({
      legacy: [],
      current: [],
    });
    expect(current.counts.entries).toBe(legacy.counts.entries);
  });

  it.each(invalidGuides)(
    'should reject $name',
    ({ mutate, file = 'guides/foot.json' }) => {
      const fixture = createGuideFixture();
      mutate(fixture);

      const result = validateCorpusDocuments(
        createGuideCorpusFixture(fixture),
        { release: '1.1.0' },
      );

      expect(result.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            file,
            path: expect.stringMatching(/^\$/),
            code: expect.any(String),
          }),
        ]),
      );
    },
  );

  it('should retain unsourced original text as an explicit gap and allow missing images', () => {
    const fixture = createGuideFixture();
    const check = fixture.guide.checks[0]!;
    Object.assign(check.statements[0]!, {
      supportState: 'needs_source',
      citationIds: [],
    });
    check.statements.pop();
    check.gap = {
      fields: ['what', 'warningSigns'],
      need: 'Find direct evidence.',
    };
    check.imageIds = [];

    expect(
      validateCorpusDocuments(createGuideCorpusFixture(fixture), {
        release: '1.1.0',
      }).issues,
    ).toEqual([]);
  });

  it.each(['typical', 'warning'] as const)(
    'should accept an authorized image with the %s role',
    (role) => {
      const fixture = createGuideFixture();
      fixture.source.images[0]!.role = role;

      expect(
        validateCorpusDocuments(createGuideCorpusFixture(fixture), {
          release: '1.1.0',
        }).issues,
      ).toEqual([]);
    },
  );

  it('should accept attributed historical verdicts only as flagged archive evidence', () => {
    const fixture = createGuideFixture();
    Object.assign(fixture.source.citations[0]!, {
      attributedOpinion: true,
      verdictLanguage: true,
    });
    for (const statement of fixture.guide.checks[0]!.statements) {
      Object.assign(statement, {
        attributedOpinion: true,
        verdictLanguage: true,
      });
    }

    expect(
      validateCorpusDocuments(createGuideCorpusFixture(fixture), {
        release: '1.1.0',
      }).issues,
    ).toEqual([]);
  });

  it('should accept a book page excerpt without inventing a scan index', () => {
    const fixture = createGuideFixture();
    fixture.source.locators = [
      {
        kind: 'page',
        id: fixture.source.locators[0]!.id,
        pageId: 'antica:page:foot',
        printedPageLabel: 'xvii',
        excerpt: fixture.source.citations[0]!.quote,
      },
    ];

    expect(
      validateCorpusDocuments(createGuideCorpusFixture(fixture), {
        release: '1.1.0',
      }).issues,
    ).toEqual([]);
  });

  it('should reject a page excerpt absent from the captured book payload', () => {
    const fixture = createGuideFixture();
    fixture.source.locators = [
      {
        kind: 'page',
        id: fixture.source.locators[0]!.id,
        pageId: 'antica:page:foot',
        pageIndex: 0,
        printedPageLabel: '1',
        excerpt: 'Invented book passage.',
      },
    ];
    fixture.source.citations[0]!.quote = 'Invented book passage.';

    expect(
      validateCorpusDocuments(createGuideCorpusFixture(fixture), {
        release: '1.1.0',
      }).issues,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          file: 'sources/guide/book.json',
          path: expect.stringContaining('locators'),
        }),
      ]),
    );
  });
});

describe('book page parsing', () => {
  it.each([
    { printedPageLabel: null },
    { printedPageLabel: '' },
    { printedPageLabel: '   ' },
    { printedPageLabel: '1', pageIndex: -1 },
    { printedPageLabel: '1', pageIndex: 0.5 },
  ])(
    'should reject ambiguous or invalid page coordinates %j',
    (coordinates) => {
      const fixture = createGuideFixture();
      const input = {
        ...fixture.source,
        locators: [
          {
            kind: 'page',
            id: 'antica:locator:page',
            pageId: 'antica:page:book',
            excerpt: fixture.source.citations[0]!.quote,
            ...coordinates,
          },
        ],
      };

      expect(corpusFileSchema.safeParse(input).success).toBe(false);
    },
  );

  it('should accept zero as a verified scan index without a printed label', () => {
    const fixture = createGuideFixture();
    const input = {
      ...fixture.source,
      locators: [
        {
          kind: 'page',
          id: 'antica:locator:page',
          pageId: 'antica:page:book',
          excerpt: fixture.source.citations[0]!.quote,
          pageIndex: 0,
          printedPageLabel: null,
        },
      ],
    };

    expect(corpusFileSchema.parse(input)).toEqual(input);
  });
});
