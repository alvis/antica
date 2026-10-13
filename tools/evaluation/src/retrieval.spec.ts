import { describe, expect, it } from 'vitest';

import { readCorpus } from './dataset.js';
import { createTextEntries, evaluateRetrieval } from './retrieval.js';

describe('fn:evaluateRetrieval', () => {
  it('should preserve original source text and rank against independent relevance labels', async () => {
    const corpus = await readCorpus();
    const result = await evaluateRetrieval(corpus, 1);

    expect(
      result.evaluations.map((evaluation) => ({
        queryId: evaluation.queryId,
        rankedIds: evaluation.rankedIds,
        scores: evaluation.scores,
        error: evaluation.error,
      })),
    ).toEqual([
      {
        queryId: 'surface-inspection',
        rankedIds: ['30000000-0000-4000-8000-000000000001'],
        scores: { recallAtK: 0.5, normalizedDiscountedCumulativeGain: 1 },
        error: null,
      },
      {
        queryId: 'base-inscription',
        rankedIds: ['30000000-0000-4000-8000-000000000002'],
        scores: { recallAtK: 0.5, normalizedDiscountedCumulativeGain: 1 },
        error: null,
      },
    ]);
    const entry = createTextEntries(corpus)[0];
    expect(entry?.citation.locator).toMatchObject({
      kind: 'web',
      excerptAsRetrieved: entry?.contentAsRetrieved,
    });
    expect(result.evaluations[0]?.snapshot?.text[0]?.contentAsRetrieved).toBe(
      corpus.documents[0]?.text,
    );
  });

  it('should preserve an incompatible index error without calculating a retrieval score', async () => {
    const report = await evaluateRetrieval(await readCorpus(), 1, {
      embeddingModelId: 'foreign',
      dimensions: 1,
      indexVersion: 'lexical-v1',
    });
    expect(
      report.evaluations.every(
        (evaluation) => evaluation.error !== null && evaluation.scores === null,
      ),
    ).toBe(true);
  });
});
