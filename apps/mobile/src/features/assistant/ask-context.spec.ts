import { describe, expect, it } from '@jest/globals';

import { createI18n } from '../../i18n/i18n';

import { summarizeAskContext, suggestAskQuestions } from './ask-context';

import type { LocaleState } from '../../providers/LocaleProvider';

import type { AskContext } from './ask-context';

const t = createI18n('zh-Hant').t as unknown as LocaleState['t'];

describe('fn:summarizeAskContext', () => {
  it.each<{ context: AskContext; card: [string, string, string] }>([
    {
      context: { kind: 'record', recordId: 'f3a9c2d18b', code: 'AC-0001' },
      card: ['關於這件藏品', 'AC-0001', '附上：藏品 AC-0001'],
    },
    {
      context: { kind: 'record', recordId: 'f3a9c2d18b' },
      card: ['關於這件藏品', 'f3a9c2d1', '附上：藏品 f3a9c2d1'],
    },
    {
      context: {
        kind: 'suggestion',
        recordId: 'r1',
        field: '年代',
        evidence: ['灰胎', '細開片'],
      },
      card: ['關於這項建議', '年代', '附上：「年代」的建議與 2 項證據'],
    },
    {
      context: { kind: 'knowledge', entryId: '0b7a1f5e2c', title: '汝窯' },
      card: ['關於這條知識', '汝窯', '附上：條目 0b7a1f5e'],
    },
    {
      context: { kind: 'capture', check: '底足' },
      card: ['關於拍攝清單', '底足', '目前：底足'],
    },
  ])('should state what $context.kind attaches', ({ context, card }) => {
    const { kicker, name, detail } = summarizeAskContext(context, t);

    expect([kicker, name, detail]).toEqual(card);
  });
});

describe('fn:suggestAskQuestions', () => {
  it.each<AskContext>([
    { kind: 'record', recordId: 'r1' },
    { kind: 'suggestion', recordId: 'r1', field: '年代', evidence: [] },
    { kind: 'knowledge', entryId: 'e1', title: '汝窯' },
    { kind: 'capture', check: '底足' },
    { kind: 'none' },
  ])('should offer two or three questions for $kind', (context) => {
    const questions = suggestAskQuestions(context, t);

    expect(questions.length).toBeGreaterThanOrEqual(2);
    expect(questions.length).toBeLessThanOrEqual(3);
  });

  it('should route record questions to that record and never offer a write', () => {
    const questions = suggestAskQuestions(
      { kind: 'suggestion', recordId: 'r1', field: '年代', evidence: [] },
      t,
    );

    expect(
      questions.map((question) =>
        question.kind === 'message' ? question.recordId : question.kind,
      ),
    ).toEqual(['r1', 'r1', 'help']);
    expect(questions[0].text).toBe('為什麼建議修改「年代」？');
  });

  it('should search the knowledge base with the entry title for related records', () => {
    const [related] = suggestAskQuestions(
      { kind: 'knowledge', entryId: 'e1', title: '汝窯的胎、釉與支釘痕' },
      t,
    );

    expect(related).toMatchObject({
      kind: 'search',
      query: '汝窯的胎、釉與支釘痕',
    });
  });
});
