import type { RefinementCtx } from 'zod';

interface CitedNode {
  readonly claimKey: string;
  readonly text: string;
  readonly citationIds: readonly string[];
  readonly supportState: 'cited' | 'needs_source';
}

interface ClaimVariant {
  readonly language: string;
  readonly kind: 'original' | 'translation';
  readonly text: string;
  readonly method: 'original' | 'human' | 'machine';
}

interface Claim {
  readonly claimKey: string;
  readonly section: string;
  readonly ordinal: number;
  readonly originalText: string;
  readonly originalLanguage: string;
  readonly supportState: 'cited' | 'needs_source';
  readonly citationIds: readonly string[];
  readonly variants: readonly ClaimVariant[];
}

interface EnvelopeConsistencyValue {
  readonly sections: {
    readonly summary: CitedNode;
    readonly history: readonly CitedNode[];
    readonly features: readonly CitedNode[];
    readonly applicability: readonly CitedNode[];
    readonly limits: readonly CitedNode[];
  };
  readonly claims: readonly Claim[];
  readonly citations: ReadonlyArray<{
    readonly id: string;
    readonly relation: string;
    readonly verification: string;
  }>;
  readonly topics: ReadonlyArray<{ readonly topicId: string }>;
  readonly images: ReadonlyArray<{ readonly id: string }>;
  readonly methodIds: readonly string[];
  readonly methodVersionIds?: readonly string[];
  readonly relatedEntryIds: readonly string[];
}

interface PositionedNode {
  readonly node: CitedNode;
  readonly section: string;
  readonly ordinal: number;
}

/**
 * Validates one language identifier through the platform BCP47 implementation.
 * @param value candidate language identifier
 * @returns whether the identifier is canonicalizable as BCP47
 */
export function isBcp47Language(value: string): boolean {
  try {
    return Intl.getCanonicalLocales(value).length === 1;
  } catch {
    return false;
  }
}

/**
 * Validates cross-field identities and projection-safe uniqueness.
 * @param content envelope fields participating in consistency checks
 * @param context Zod refinement context receiving validation issues
 */
export function validateEnvelopeConsistency(
  content: EnvelopeConsistencyValue,
  context: RefinementCtx,
): void {
  const claims = new Map(
    content.claims.map((claim) => [claim.claimKey, claim]),
  );
  const nodes = positionedNodes(content.sections);
  addIssueWhen(
    context,
    claims.size !== content.claims.length,
    'claim keys must be unique',
  );
  addIssueWhen(
    context,
    nodes.length !== content.claims.length,
    'every granular claim must have exactly one cited-text node',
  );
  validateUniqueCollections(content, context);
  validateNodes(nodes, claims, context);
  validateClaims(content, context);
}

/**
 * Builds the canonical ordered list of cited nodes.
 * @param sections content sections to flatten
 * @returns cited nodes with canonical positions
 */
function positionedNodes(
  sections: EnvelopeConsistencyValue['sections'],
): PositionedNode[] {
  const position =
    (section: string) =>
    (node: CitedNode, ordinal: number): PositionedNode => ({
      node,
      section,
      ordinal,
    });

  return [
    { node: sections.summary, section: 'summary', ordinal: 0 },
    ...sections.history.map(position('history')),
    ...sections.features.map(position('features')),
    ...sections.applicability.map(position('applicability')),
    ...sections.limits.map(position('limits')),
  ];
}

/**
 * Rejects duplicate identifiers in normalized projection collections.
 * @param content envelope collections to inspect
 * @param context Zod refinement context receiving issues
 */
function validateUniqueCollections(
  content: EnvelopeConsistencyValue,
  context: RefinementCtx,
): void {
  const collections = [
    [content.citations.map((citation) => citation.id), 'citation ids'],
    [content.topics.map((topic) => topic.topicId), 'topic ids'],
    [content.images.map((image) => image.id), 'image ids'],
    [content.methodIds, 'method ids'],
    [content.methodVersionIds ?? [], 'method version ids'],
    [content.relatedEntryIds, 'related entry ids'],
  ] as const;
  for (const [identifiers, label] of collections) {
    addIssueWhen(
      context,
      new Set(identifiers).size !== identifiers.length,
      `${label} must be unique`,
    );
  }
}

/**
 * Verifies every cited node matches its granular claim.
 * @param nodes positioned cited nodes
 * @param claims claims indexed by stable key
 * @param context Zod refinement context receiving issues
 */
function validateNodes(
  nodes: readonly PositionedNode[],
  claims: ReadonlyMap<string, Claim>,
  context: RefinementCtx,
): void {
  for (const { node, section, ordinal } of nodes) {
    const claim = claims.get(node.claimKey);
    addIssueWhen(
      context,
      claim?.section !== section ||
        claim.ordinal !== ordinal ||
        claim.supportState !== node.supportState ||
        claim.originalText !== node.text ||
        claim.citationIds.length !== node.citationIds.length ||
        claim.citationIds.some((id, index) => id !== node.citationIds[index]),
      'cited text must match its granular claim',
    );
  }
}

/**
 * Verifies claim locations, citation support, and variants.
 * @param content envelope claims and citations
 * @param context Zod refinement context receiving issues
 */
function validateClaims(
  content: EnvelopeConsistencyValue,
  context: RefinementCtx,
): void {
  const citations = new Map(
    content.citations.map((citation) => [citation.id, citation]),
  );
  const ordinals = new Set<string>();
  for (const claim of content.claims) {
    const ordinal = `${claim.section}\u0000${claim.ordinal}`;
    addIssueWhen(
      context,
      ordinals.has(ordinal),
      'claim section ordinals must be unique',
    );
    ordinals.add(ordinal);
    addIssueWhen(
      context,
      claim.supportState === 'cited' &&
        !claim.citationIds.some((id) => {
          const citation = citations.get(id);

          return (
            citation?.relation === 'supports' &&
            citation.verification === 'located'
          );
        }),
      'cited claims need a located supporting citation',
    );
    validateVariants(claim, context);
  }
}

/**
 * Rejects duplicate or contradictory language variants.
 * @param claim claim whose variants are checked
 * @param context Zod refinement context receiving issues
 */
function validateVariants(claim: Claim, context: RefinementCtx): void {
  const variants = new Set<string>();
  for (const variant of claim.variants) {
    const identity = `${variant.language}\u0000${variant.kind}`;
    addIssueWhen(
      context,
      variants.has(identity),
      'claim variants must be unique',
    );
    variants.add(identity);
    addIssueWhen(
      context,
      variant.kind === 'original' &&
        (variant.language !== claim.originalLanguage ||
          variant.text !== claim.originalText ||
          variant.method !== 'original'),
      'original variant must match its claim',
    );
  }
}

/**
 * Adds a custom Zod issue when an invariant fails.
 * @param context Zod refinement context receiving issues
 * @param condition whether the invariant failed
 * @param message validation message
 */
function addIssueWhen(
  context: RefinementCtx,
  condition: boolean,
  message: string,
): void {
  if (condition) {
    context.addIssue({ code: 'custom', message });
  }
}
