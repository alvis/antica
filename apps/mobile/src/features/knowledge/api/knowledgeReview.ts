import type {
  KnowledgeContentEnvelopeV2,
  KnowledgeEntryDetailV2,
  KnowledgeUpdateV2,
} from '@antica/contracts';

/**
 * builds the explicit review operation without retaining server review actors
 * @param entry current owner-scoped revision
 * @param edits retained original-language title and summary edits
 * @param edits.title requested original title
 * @param edits.summary requested original summary
 * @returns the review body before its idempotency identity is added
 */
export function knowledgeReviewBody(
  entry: KnowledgeEntryDetailV2,
  edits: { title: string | null; summary: string | null },
): Omit<KnowledgeUpdateV2, 'requestKey'> {
  const content = entry.content;
  const summary = edits.summary ?? content.sections.summary.text;

  return {
    expectedRevision: entry.revision,
    status: 'saved' as const,
    content: {
      ...content,
      titles: content.titles.map((title, index) =>
        index === 0 ? { ...title, text: edits.title ?? title.text } : title,
      ),
      sections: {
        ...content.sections,
        summary: { ...content.sections.summary, text: summary },
      },
      claims: reviewedClaims(content, summary),
      editorialReview: { state: content.editorialReview.state },
    },
    reviewDecisions: content.claims.map((claim) => ({
      claimKey: claim.claimKey,
      state: 'reviewed' as const,
    })),
    translationDecisions: [],
  };
}
/**
 * updates the summary claim and invalidates affected variant reviews
 * @param content current content
 * @param summary requested original summary
 * @returns review inputs for each claim
 */
function reviewedClaims(
  content: KnowledgeContentEnvelopeV2,
  summary: string,
): KnowledgeUpdateV2['content']['claims'] {
  const summaryKey = content.sections.summary.claimKey;
  const editedSummary = summary !== content.sections.summary.text;

  return content.claims.map((claim) => ({
    ...claim,
    originalText: claim.claimKey === summaryKey ? summary : claim.originalText,
    review: { state: claim.review.state },
    variants: claim.variants.map((variant) => ({
      ...variant,
      text:
        editedSummary &&
        claim.claimKey === summaryKey &&
        variant.kind === 'original'
          ? summary
          : variant.text,
      review: {
        state:
          editedSummary && claim.claimKey === summaryKey
            ? 'pending'
            : variant.review.state,
      },
    })),
  }));
}
