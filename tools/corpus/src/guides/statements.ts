import type { CorpusGuideStatement } from '@antica/contracts';

import type { CorpusContext, Located } from '../context.js';

const verdictPattern =
  /\b(?:authentic|fake|genuine|forged|forger(?:y|ies)|counterfeit|spurious)\b|真品|贗品|赝品|偽品|伪品|假貨|假货|作偽|作伪/i;
/**
 * preserves unsupported text as a marked gap and propagates opinion exclusions
 * @param context indexed corpus and diagnostic collector
 * @param record statement and its location
 */
export function validateGuideStatement(
  context: CorpusContext,
  record: Located<CorpusGuideStatement>,
): void {
  const statement = record.value;
  context.check(
    statement.supportState !== 'needs_source' ||
      statement.citationIds.length === 0,
    { ...record, path: `${record.path}.citationIds` },
    {
      code: 'guide_unsourced_citation',
      message: 'Archived unsourced statements cannot claim citation support',
    },
  );
  const hasVerdict = [
    statement.originalText,
    ...statement.variants.map((variant) => variant.text),
  ].some((text) => verdictPattern.test(text));
  context.check(
    !hasVerdict ||
      (statement.verdictLanguage === true &&
        statement.attributedOpinion === true),
    record,
    {
      code: 'guide_verdict',
      message:
        'Verdict wording must be flagged as attributed opinion and verdict language',
    },
  );
  validateCitationExclusions(context, record);
}

/**
 * propagates source opinion and verdict flags to referencing statements
 * @param context indexed corpus and diagnostic collector
 * @param record statement and its location
 */
function validateCitationExclusions(
  context: CorpusContext,
  record: Located<CorpusGuideStatement>,
): void {
  const statement = record.value;
  statement.citationIds.forEach((id) => {
    const citation = context.citations.get(id);
    if (citation === undefined) {
      return;
    }
    const hasQuotedVerdict = verdictPattern.test(citation.value.quote);
    context.check(
      !hasQuotedVerdict ||
        (citation.value.verdictLanguage === true &&
          citation.value.attributedOpinion === true),
      citation,
      {
        code: 'guide_citation_verdict',
        message:
          'Quoted verdict wording must be flagged as attributed opinion and verdict language',
      },
    );
    context.check(
      (!citation.value.attributedOpinion ||
        statement.attributedOpinion === true) &&
        (!citation.value.verdictLanguage ||
          statement.verdictLanguage === true) &&
        (!hasQuotedVerdict ||
          (statement.attributedOpinion === true &&
            statement.verdictLanguage === true)),
      record,
      {
        code: 'guide_opinion',
        message:
          'Statements must preserve opinion and verdict exclusions from every cited source',
      },
    );
  });
}
