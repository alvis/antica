import { createHash } from 'node:crypto';

import { knowledgeContentEnvelopeV2Schema } from '@antica/contracts';

import {
  canonicalHash,
  canonicalJson,
  projectionId,
} from '../knowledge/canonical.js';
import { resolvePointer } from '../knowledge/references.js';

import type {
  KnowledgeContentEnvelopeV2,
  MappedObject,
  ProviderSnapshot,
} from '@antica/contracts';

const maximumLocatorExcerptLength = 24_000;

interface Binding {
  readonly source: MappedObject['source'];
  readonly bind: (id: string) => string;
  readonly locatorIds: ReadonlyMap<string, string>;
}
/**
 * binds citations to exact fields in a captured immutable version
 * @param mapped validated adapter mapping
 * @param snapshot captured provider payload
 * @param binding owner-private reference identities
 * @returns validated, pinned citations
 */
function bindCitations(
  mapped: MappedObject,
  snapshot: ProviderSnapshot,
  binding: Binding,
): KnowledgeContentEnvelopeV2['citations'] {
  return mapped.draft.citations.map((citation) => {
    const locator = citation.locator;
    if (
      citation.source.id !== mapped.source.id ||
      citation.source.versionId !== mapped.source.versionId ||
      canonicalJson(citation.source) !== canonicalJson(mapped.source) ||
      locator.sourceId !== mapped.source.id ||
      locator.sourceVersionId !== mapped.source.versionId ||
      !locator.excerpt.includes(citation.quote) ||
      locator.kind === 'page' ||
      locator.url !== snapshot.sourcePageUrl ||
      locator.retrievedAt !== snapshot.retrievedAt
    ) {
      throw new Error('Mapped citation is not pinned to the captured source');
    }
    const excerpt = capturedExcerpt(snapshot, locator);

    return {
      ...citation,
      id: binding.bind(citation.id),
      source: binding.source,
      locator: {
        ...locator,
        excerpt,
        id: binding.locatorIds.get(locator.id)!,
        sourceId: binding.source.id,
        sourceVersionId: binding.source.versionId,
      },
    };
  });
}

/**
 * validates structured fields or verbatim web text without inventing field paths
 * @param snapshot captured immutable provider metadata or text
 * @param locator proposed evidence location
 * @returns canonical field text or the exact captured web excerpt
 */
function capturedExcerpt(
  snapshot: ProviderSnapshot,
  locator: Exclude<
    KnowledgeContentEnvelopeV2['citations'][number]['locator'],
    { kind: 'page' }
  >,
): string {
  if (locator.kind === 'web') {
    if (
      locator.section !== undefined ||
      !containsCapturedText(snapshot.payload, locator.excerpt)
    ) {
      throw new Error(
        'Web excerpt is not captured or requires an unsupported section block',
      );
    }

    return locator.excerpt;
  }
  const value = resolvePointer(snapshot.payload, locator.fieldPath);
  const excerpt = typeof value === 'string' ? value : canonicalJson(value);
  if (
    locator.provider !== snapshot.provider ||
    locator.objectId !== snapshot.objectId ||
    value === undefined ||
    canonicalHash(value) !== locator.valueHash ||
    !excerpt.includes(locator.excerpt) ||
    excerpt.length > maximumLocatorExcerptLength
  ) {
    throw new Error('Mapped field does not resolve in captured JSON');
  }

  return excerpt;
}

/**
 * finds verbatim web evidence in bounded captured text values
 * @param payload canonical captured metadata or page text
 * @param excerpt exact adapter-selected excerpt
 * @returns whether at least one captured text value contains the excerpt
 */
function containsCapturedText(
  payload: ProviderSnapshot['payload'],
  excerpt: string,
): boolean {
  if (typeof payload === 'string') {
    return payload.includes(excerpt);
  }

  return (
    payload !== null &&
    typeof payload === 'object' &&
    Object.values(payload).some((value) => containsCapturedText(value, excerpt))
  );
}

/**
 * projects adapter-local references into the owner-private envelope
 * @param mapped validated adapter mapping
 * @param snapshot captured payload and retrieval instant
 * @param binding deterministic evidence identities
 * @returns immutable validated v2 envelope
 */
export function bindImportDraft(
  mapped: MappedObject,
  snapshot: ProviderSnapshot,
  binding: Binding,
): KnowledgeContentEnvelopeV2 {
  return knowledgeContentEnvelopeV2Schema.parse({
    ...mapped.draft,
    citations: bindCitations(mapped, snapshot, binding),
    claims: mapped.draft.claims.map((claim) => {
      const textHash = createHash('sha256')
        .update(claim.originalText)
        .digest('hex');
      if (
        claim.variants.some(
          (variant) =>
            variant.kind === 'original' && variant.sourceTextHash !== textHash,
        )
      ) {
        throw new Error('Original variant differs from captured claim');
      }

      return { ...claim, citationIds: claim.citationIds.map(binding.bind) };
    }),
    sections: bindSections(mapped, binding),
    images: [
      ...new Map(
        mapped.draft.images.map((image) => [image.imageUrl, image]),
      ).values(),
    ].map((image) => {
      if (
        image.sourceVersionId !== mapped.source.versionId ||
        image.provider !== snapshot.provider ||
        image.sourcePageUrl !== snapshot.sourcePageUrl
      ) {
        throw new Error('Mapped image differs from captured source');
      }

      return {
        ...image,
        id: projectionId(
          `${binding.source.versionId}:image:${canonicalHash(image.imageUrl)}`,
        ),
        sourceVersionId: binding.source.versionId,
        locatorId:
          image.locatorId === undefined
            ? undefined
            : binding.locatorIds.get(image.locatorId),
      };
    }),
  });
}

/**
 * keeps section citation links aligned with their owner-private claim references
 * @param mapped adapter-local envelope
 * @param binding stable citation identifiers
 * @returns rebound sections
 */
function bindSections(
  mapped: MappedObject,
  binding: Binding,
): KnowledgeContentEnvelopeV2['sections'] {
  return {
    ...mapped.draft.sections,
    summary: {
      ...mapped.draft.sections.summary,
      citationIds: mapped.draft.sections.summary.citationIds.map(binding.bind),
    },
    history: mapped.draft.sections.history.map((node) => ({
      ...node,
      citationIds: node.citationIds.map(binding.bind),
    })),
    features: mapped.draft.sections.features.map((node) => ({
      ...node,
      citationIds: node.citationIds.map(binding.bind),
    })),
    applicability: mapped.draft.sections.applicability.map((node) => ({
      ...node,
      citationIds: node.citationIds.map(binding.bind),
    })),
    limits: mapped.draft.sections.limits.map((node) => ({
      ...node,
      citationIds: node.citationIds.map(binding.bind),
    })),
  };
}
