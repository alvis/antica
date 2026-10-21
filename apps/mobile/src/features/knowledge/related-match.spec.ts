import { describe, expect, it, jest } from '@jest/globals';

import { translator } from '../../i18n/translate.spec.fixtures';

import { describeRelatedMatch, relatedMatchField } from './related-match';

import type { RelatedKnowledgePage } from '@antica/contracts';

jest.mock('../../providers/AuthProvider', () => ({ useAuth: jest.fn() }));

type Match = RelatedKnowledgePage['cards'][number]['matches'][number];

const zh = translator('zh-Hant');

/**
 * one match reason
 * @param overrides the fields that differ from a saved material match
 * @returns the match
 */
const match = (overrides: Partial<Match>): Match => ({
  field: 'material',
  source: 'record',
  value: '炻器',
  topicId: null,
  label: '炻器',
  matchedTokens: [],
  ...overrides,
});

describe('fn:describeRelatedMatch', () => {
  it('should quote a saved field as the record holds it', () => {
    expect(describeRelatedMatch(match({}), zh, 'zh-Hant')).toBe('材質「炻器」');
  });

  it('should name a suggested value as a suggestion so it never reads as saved', () => {
    expect(
      describeRelatedMatch(match({ source: 'suggestion' }), zh, 'zh-Hant'),
    ).toBe('建議的材質「炻器」');
  });

  it('should read a one-character dynasty as the period tile does', () => {
    expect(
      describeRelatedMatch(
        match({ field: 'period', value: '清', label: '清' }),
        zh,
        'zh-Hant',
      ),
    ).toBe('年代「清代」');
  });
});

describe('fn:relatedMatchField', () => {
  it('should name the matched field, marking a suggestion', () => {
    expect(relatedMatchField(match({ field: 'name' }), zh)).toBe('名稱');
    expect(
      relatedMatchField(match({ field: 'name', source: 'suggestion' }), zh),
    ).toBe('建議的名稱');
  });
});
