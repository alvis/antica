/** describes one ranked retrieval result and independent graded relevance labels */
export interface RetrievalScoringParams {
  readonly rankedIds: readonly string[];
  readonly relevance: Readonly<Record<string, number>>;
  readonly limit: number;
}

/** records ranking metrics, with null when no relevant ground truth exists */
export interface RetrievalScores {
  readonly recallAtK: number | null;
  readonly normalizedDiscountedCumulativeGain: number | null;
}

/** bounds the authored evaluation relevance scale to prevent exponential gain overflow */
export const maximumRelevanceGrade = 3;

/**
 * scores retrieval against authored graded judgments
 * @param params ordered candidates, relevance grades, and cutoff
 * @returns recall and normalized discounted cumulative gain
 * @throws {RangeError} when rankings or judgment parameters cannot be scored
 */
export function scoreRetrieval(
  params: RetrievalScoringParams,
): RetrievalScores {
  if (
    !Number.isInteger(params.limit) ||
    params.limit < 1 ||
    Object.values(params.relevance).some(
      (grade) =>
        !Number.isFinite(grade) || grade < 0 || grade > maximumRelevanceGrade,
    )
  ) {
    throw new RangeError(
      'Retrieval scoring requires a positive integer cutoff and finite nonnegative grades',
    );
  }
  if (new Set(params.rankedIds).size !== params.rankedIds.length) {
    throw new RangeError('Retrieval returned duplicate candidate IDs');
  }
  const ranked = params.rankedIds.slice(0, params.limit);
  const grades = Object.values(params.relevance).filter((grade) => grade > 0);
  const gain = ranked.reduce(
    (sum, id, rank) =>
      sum + (2 ** (params.relevance[id] ?? 0) - 1) / Math.log2(rank + 2),
    0,
  );
  const ideal = grades
    .toSorted((left, right) => right - left)
    .slice(0, params.limit)
    .reduce(
      (sum, grade, rank) => sum + (2 ** grade - 1) / Math.log2(rank + 2),
      0,
    );

  return {
    recallAtK:
      grades.length === 0
        ? null
        : ranked.filter((id) => (params.relevance[id] ?? 0) > 0).length /
          grades.length,
    normalizedDiscountedCumulativeGain: ideal === 0 ? null : gain / ideal,
  };
}
