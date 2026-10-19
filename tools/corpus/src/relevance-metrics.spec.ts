import { describe, expect, it } from 'vitest';

import { scoreRelevance } from './relevance-metrics.js';

describe('fn:scoreRelevance', () => {
  it('should use positive grades, unique top-five recall and first top-ten relevant rank', () => {
    expect(
      scoreRelevance([
        {
          id: 'a',
          category: 'ceramics',
          relevance: [
            { entryId: 'yes', grade: 3 },
            { entryId: 'also', grade: 1 },
            { entryId: 'no', grade: 0 },
          ],
          retrieved: ['no', 'yes', 'yes', 'unjudged', 'other', 'also'],
        },
        {
          id: 'b',
          category: 'jades',
          relevance: [{ entryId: 'lost', grade: 2 }],
          retrieved: ['unjudged'],
        },
      ]),
    ).toEqual({
      questions: 2,
      supportedQuestions: 2,
      noSupportQuestions: 0,
      recallAt5: 0.25,
      mrrAt10: 0.25,
      noSupportEmptyResults: 0,
    });
  });
  it('should report unsupported questions separately without inventing accuracy', () => {
    expect(
      scoreRelevance([
        { id: 'a', category: 'jades', relevance: [], retrieved: [] },
        {
          id: 'b',
          category: 'jades',
          relevance: [{ entryId: 'no', grade: 0 }],
          retrieved: ['no'],
        },
      ]),
    ).toEqual({
      questions: 2,
      supportedQuestions: 0,
      noSupportQuestions: 2,
      recallAt5: null,
      mrrAt10: null,
      noSupportEmptyResults: 1,
    });
    expect(scoreRelevance([]).recallAt5).toBeNull();
  });
  it('should exclude relevant results beyond the tenth rank', () => {
    expect(
      scoreRelevance([
        {
          id: 'a',
          category: 'jades',
          relevance: [{ entryId: 'yes', grade: 1 }],
          retrieved: [
            ...Array.from({ length: 10 }, (_, index) => String(index)),
            'yes',
          ],
        },
      ]).mrrAt10,
    ).toBe(0);
  });
});
