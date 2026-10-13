export type AnalysisFreshness = 'unanalyzed' | 'current' | 'outdated';

const analysisRelevantFields = new Set([
  'name',
  'unitKind',
  'components',
  'pieceCount',
  'categoryIds',
  'materialIds',
  'period',
  'dimensions',
  'tags',
  'description',
  'collectorJudgment',
]);

/**
 * Identifies record fields that change the inputs to analysis.
 * @param field Record field name.
 * @returns Whether the field is relevant to analysis freshness.
 */
export function isAnalysisRelevantRecordField(field: string): boolean {
  return analysisRelevantFields.has(field);
}

/**
 * Compares the latest analyzed input version with the current record version.
 * @param latestRunInputVersion Version used by the latest run, if any.
 * @param currentInputVersion Current record analysis input version.
 * @returns The record's analysis freshness state.
 */
export function calculateAnalysisFreshness(
  latestRunInputVersion: number | null,
  currentInputVersion: number,
): AnalysisFreshness {
  if (latestRunInputVersion === null) {
    return 'unanalyzed';
  }

  return latestRunInputVersion === currentInputVersion ? 'current' : 'outdated';
}
