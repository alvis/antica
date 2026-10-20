import { expect, it, jest } from '@jest/globals';

import { Linking } from 'react-native';

import {
  knowledgeClaimV2Schema,
  knowledgeSearchQuerySchema,
} from '@antica/contracts';

import { knowledgeEntry } from '../containers/knowledge-journey.spec.fixtures';

import {
  claimText,
  knowledgeSearchPath,
  openKnowledgeSource,
} from './knowledge';
import { knowledgeReviewBody } from './knowledgeReview';

const topicId = '00000000-0000-4000-8000-000000000061';
const otherTopicId = '00000000-0000-4000-8000-000000000062';
const sourceTextHash = 'a'.repeat(64);
const claim = knowledgeClaimV2Schema.parse({
  claimKey: 'surface',
  section: 'summary',
  ordinal: 0,
  originalText: '黃花梨表面呈深色',
  originalLanguage: 'zh-Hant',
  statementType: 'observation',
  scope: {},
  qualifiers: {},
  supportState: 'needs_source',
  citationIds: [],
  review: {
    state: 'reviewed',
    actor: 'collector',
    at: '2026-10-13T00:00:00.000Z',
  },
  variants: [
    {
      language: 'en',
      kind: 'translation',
      text: 'The huanghuali surface is dark',
      method: 'human',
      sourceTextHash,
      review: {
        state: 'reviewed',
        actor: 'collector',
        at: '2026-10-13T00:00:00.000Z',
      },
    },
    {
      language: 'en',
      kind: 'translation',
      text: 'An unreviewed rendering',
      method: 'machine',
      sourceTextHash,
      review: { state: 'pending' },
    },
  ],
});

it('should encode the complete search selection for the V2 discovery route', () => {
  const selection = knowledgeSearchQuerySchema.parse({
    q: '黃花梨 wood',
    view: 'working',
    locale: 'en',
    limit: 17,
    cursor: 'next/page+1',
    topics: { category: [topicId, otherTopicId], material: [otherTopicId] },
    providers: ['Cleveland Museum of Art', 'The Met'],
    languages: ['zh-Hant', 'en'],
    entryTypes: ['concept', 'object_example'],
  });

  const path = knowledgeSearchPath(selection);
  const url = new URL(path, 'https://antica.test');

  expect(url.pathname).toBe('/v1/knowledge/search');
  expect(url.searchParams.get('q')).toBe('黃花梨 wood');
  expect(url.searchParams.get('view')).toBe('working');
  expect(url.searchParams.get('locale')).toBe('en');
  expect(url.searchParams.get('limit')).toBe('17');
  expect(url.searchParams.get('cursor')).toBe('next/page+1');
  expect(JSON.parse(url.searchParams.get('topics') ?? '{}')).toEqual(
    selection.topics,
  );
  expect(url.searchParams.getAll('providers')).toEqual(selection.providers);
  expect(url.searchParams.getAll('languages')).toEqual(selection.languages);
  expect(url.searchParams.getAll('entryTypes')).toEqual(selection.entryTypes);
});

it('should omit absent optional search filters while preserving saved defaults', () => {
  const path = knowledgeSearchPath(knowledgeSearchQuerySchema.parse({}));
  const url = new URL(path, 'https://antica.test');

  expect(url.pathname).toBe('/v1/knowledge/search');
  expect(url.searchParams.get('view')).toBe('saved');
  expect(url.searchParams.get('locale')).toBe('zh-Hant');
  expect(url.searchParams.get('limit')).toBe('20');
  expect(url.searchParams.has('q')).toBe(false);
  expect(url.searchParams.has('cursor')).toBe(false);
  expect(url.searchParams.has('topics')).toBe(false);
});

it('should choose a reviewed translation and retain original provenance on demand', () => {
  expect(claimText(claim, 'en', false)).toEqual({
    text: 'The huanghuali surface is dark',
    language: 'en',
    fallback: false,
  });
  expect(claimText(claim, 'en', true)).toEqual({
    text: '黃花梨表面呈深色',
    language: 'zh-Hant',
    fallback: false,
  });
});

it('should label an original-language fallback when no reviewed translation exists', () => {
  expect(
    claimText(
      {
        ...claim,
        variants: claim.variants.filter(
          (variant) => variant.review.state !== 'reviewed',
        ),
      },
      'en',
      false,
    ),
  ).toEqual({
    text: '黃花梨表面呈深色',
    language: 'zh-Hant',
    fallback: true,
  });
});

it('should open HTTP source pages and reject non-web schemes', async () => {
  const open = jest
    .spyOn(Linking, 'openURL')
    .mockImplementation(async () => undefined);

  await openKnowledgeSource('https://museum.example/object/1');
  await openKnowledgeSource('http://museum.example/object/2');
  expect(open.mock.calls).toEqual([
    ['https://museum.example/object/1'],
    ['http://museum.example/object/2'],
  ]);

  await expect(openKnowledgeSource('javascript:alert(1)')).rejects.toThrow();
  expect(open.mock.calls).toHaveLength(2);
});

it('should review an unchanged entry without rewriting its original evidence', () => {
  const body = knowledgeReviewBody(knowledgeEntry, {
    title: null,
    summary: null,
  });

  expect(body.expectedRevision).toBe(knowledgeEntry.revision);
  expect(body.status).toBe('saved');
  expect(body.content.titles).toEqual(knowledgeEntry.content.titles);
  expect(body.content.sections.summary).toEqual(
    knowledgeEntry.content.sections.summary,
  );
  expect(body.content.claims[0].originalText).toBe(claim.originalText);
  expect(body.content.claims[0].variants[0].review.state).toBe('reviewed');
  expect(body.content.editorialReview).toEqual({ state: 'reviewed' });
  expect(body.reviewDecisions).toEqual([
    { claimKey: claim.claimKey, state: 'reviewed' },
  ]);
});

it('should update only the edited summary claim and invalidate its translations', () => {
  const originalVariant = {
    ...claim.variants[0],
    language: 'zh-Hant' as const,
    kind: 'original' as const,
    method: 'original' as const,
    text: claim.originalText,
  };
  const otherClaim = {
    ...claim,
    claimKey: 'period',
    section: 'history' as const,
    ordinal: 1,
  };
  const entry = {
    ...knowledgeEntry,
    content: {
      ...knowledgeEntry.content,
      titles: [
        ...knowledgeEntry.content.titles,
        { language: 'en' as const, text: 'Chair' },
      ],
      claims: [
        { ...claim, variants: [originalVariant, ...claim.variants] },
        otherClaim,
      ],
    },
  };

  const body = knowledgeReviewBody(entry, {
    title: 'Revised original title',
    summary: 'Revised original summary',
  });

  expect(body.content.titles).toEqual([
    { language: 'zh-Hant', text: 'Revised original title' },
    { language: 'en', text: 'Chair' },
  ]);
  expect(body.content.sections.summary.text).toBe('Revised original summary');
  expect(body.content.claims[0].originalText).toBe('Revised original summary');
  expect(
    body.content.claims[0].variants.map((variant) => variant.text),
  ).toEqual([
    'Revised original summary',
    claim.variants[0].text,
    claim.variants[1].text,
  ]);
  expect(
    body.content.claims[0].variants.every(
      (variant) => variant.review.state === 'pending',
    ),
  ).toBe(true);
  expect(body.content.claims[1].originalText).toBe(otherClaim.originalText);
  expect(body.content.claims[1].variants[0].review.state).toBe('reviewed');
  expect(body.reviewDecisions).toHaveLength(2);
});
