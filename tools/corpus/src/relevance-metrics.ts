const recallLimit = 5;
const reciprocalRankLimit = 10;

/** A frozen graded question and its ordered search results. */
export interface RelevanceObservation {
  readonly id: string;
  readonly category: string;
  readonly relevance: ReadonlyArray<{ entryId: string; grade: number }>;
  readonly retrieved: readonly string[];
}

/** Macro metrics exclude questions without graded support. */
export interface RelevanceMetrics {
  readonly questions: number;
  readonly supportedQuestions: number;
  readonly noSupportQuestions: number;
  readonly recallAt5: number | null;
  readonly mrrAt10: number | null;
  readonly noSupportEmptyResults: number;
}

/**
 * Scores positive grades as relevant without treating unjudged hits as support.
 * @param observations frozen grades and retrieval order
 * @returns macro averages and explicit unsupported-question counts
 */
export function scoreRelevance(
  observations: readonly RelevanceObservation[],
): RelevanceMetrics {
  const scored = observations.map((observation) => {
    const relevant = new Set(
      observation.relevance
        .filter((item) => item.grade > 0)
        .map((item) => item.entryId),
    );
    const found = new Set(
      observation.retrieved
        .slice(0, recallLimit)
        .filter((id) => relevant.has(id)),
    );
    const first = observation.retrieved
      .slice(0, reciprocalRankLimit)
      .findIndex((id) => relevant.has(id));

    return {
      relevant: relevant.size,
      recall: found.size / relevant.size,
      reciprocalRank: first < 0 ? 0 : 1 / (first + 1),
      empty: observation.retrieved.length === 0,
    };
  });
  const supported = scored.filter((row) => row.relevant > 0);

  return {
    questions: observations.length,
    supportedQuestions: supported.length,
    noSupportQuestions: scored.length - supported.length,
    recallAt5: supported.length
      ? supported.reduce((sum, row) => sum + row.recall, 0) / supported.length
      : null,
    mrrAt10: supported.length
      ? supported.reduce((sum, row) => sum + row.reciprocalRank, 0) /
        supported.length
      : null,
    noSupportEmptyResults: scored.filter(
      (row) => row.relevant === 0 && row.empty,
    ).length,
  };
}
