import { createHash } from 'node:crypto';

import { projectionId } from './canonical.js';

import type { KnowledgeContentEnvelopeV2 } from '@antica/contracts';

import type { Prisma } from '../../generated/client.js';

type Claim = KnowledgeContentEnvelopeV2['claims'][number];

/** deterministic projections, excluding database creation timestamps */
export interface KnowledgeProjections {
  readonly claims: Prisma.CitedClaimCreateManyInput[];
  readonly citations: Prisma.CitedClaimCitationCreateManyInput[];
  readonly variants: Prisma.LanguageVariantCreateManyInput[];
  readonly topics: Prisma.KnowledgeRevisionTopicCreateManyInput[];
}

/**
 * derives original and translated rows from one immutable claim
 * @param claim captured original statement and its language variants
 * @param claimId deterministic revision-local claim identity
 * @returns normalized language variants with provenance and review metadata
 */
function projectVariants(
  claim: Claim,
  claimId: string,
): Prisma.LanguageVariantCreateManyInput[] {
  const original: Claim['variants'][number] = {
    language: claim.originalLanguage,
    kind: 'original',
    text: claim.originalText,
    method: 'original',
    sourceTextHash: createHash('sha256')
      .update(claim.originalText)
      .digest('hex'),
    review: claim.review,
  };
  const values = claim.variants.some((variant) => variant.kind === 'original')
    ? claim.variants
    : [original, ...claim.variants];

  return values.map((variant) => ({
    id: projectionId(`${claimId}:${variant.kind}:${variant.language}`),
    claimId,
    language: variant.language,
    kind: variant.kind,
    text: variant.text,
    method: variant.method,
    translator: variant.translator ?? null,
    translatedAt: variant.translatedAt ? new Date(variant.translatedAt) : null,
    sourceTextHash: variant.sourceTextHash,
    reviewState: variant.review.state,
    reviewedBy: variant.review.actor ?? null,
    reviewedAt: variant.review.at ? new Date(variant.review.at) : null,
  }));
}

/**
 * derives every normalized claim, translation, evidence and topic from one envelope
 * @param identity owner and exact aggregate revision to project
 * @param identity.ownerId required revision owner
 * @param identity.entryId knowledge aggregate identity
 * @param identity.revision exact immutable revision
 * @param content complete validated v2 envelope
 * @returns deterministic projection rows, excluding database creation timestamps
 */
export function projectKnowledge(
  identity: {
    readonly ownerId: string;
    readonly entryId: string;
    readonly revision: number;
  },
  content: KnowledgeContentEnvelopeV2,
): KnowledgeProjections {
  const { ownerId, entryId, revision } = identity;
  const claims = content.claims.map((claim) => ({
    id: projectionId(`${entryId}:${revision}:${claim.claimKey}`),
    ownerId,
    entryId,
    revision,
    claimKey: claim.claimKey,
    section: claim.section,
    ordinal: claim.ordinal,
    originalText: claim.originalText,
    originalLanguage: claim.originalLanguage,
    statementType: claim.statementType,
    scope: claim.scope,
    qualifiers: claim.qualifiers,
    uncertainty: claim.uncertainty ?? null,
    supportState: claim.supportState,
    reviewState: claim.review.state,
    reviewedBy: claim.review.actor ?? null,
    reviewedAt: claim.review.at ? new Date(claim.review.at) : null,
  }));
  const citations = content.claims.flatMap((claim, index) =>
    claim.citationIds.map((citationId) => ({
      claimId: claims[index]!.id,
      citationId,
    })),
  );
  const variants = content.claims.flatMap((claim, index) =>
    projectVariants(claim, claims[index]!.id),
  );
  const topics = content.topics.map((topic) => ({
    ownerId,
    entryId,
    revision,
    topicId: topic.topicId,
    applicability: topic.applicability,
    uncertainty: topic.uncertainty ?? null,
  }));

  return { claims, citations, variants, topics };
}
