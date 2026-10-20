import type {
  CorpusGuideStatement,
  CorpusSource,
} from '../knowledge-corpus.js';

/**
 * selects supported observations safe to show beside a collector's record
 * @param statements original guide statements, including archived gaps and opinions
 * @param citations source citations used to resolve inherited opinion flags
 * @returns original unmodified statements without gaps or verdict/opinion evidence
 */
export function filterGuideStatementsForRecord(
  statements: readonly CorpusGuideStatement[],
  citations: ReadonlyArray<CorpusSource['citations'][number]>,
): CorpusGuideStatement[] {
  const citationsById = new Map(
    citations.map((citation) => [citation.id, citation]),
  );

  return statements.filter(
    (statement) =>
      statement.supportState === 'cited' &&
      !statement.attributedOpinion &&
      !statement.verdictLanguage &&
      statement.citationIds.length > 0 &&
      statement.citationIds.every((id) => {
        const citation = citationsById.get(id);

        return (
          citation !== undefined &&
          !citation.attributedOpinion &&
          !citation.verdictLanguage
        );
      }),
  );
}
