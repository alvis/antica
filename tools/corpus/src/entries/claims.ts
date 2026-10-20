import { sha256 } from '../canonical.js';
import { unique } from '../context.js';
import { inventorySourceId } from '../inventory.js';

import type { CorpusEntry } from '@antica/contracts';

import type { CorpusContext, Located } from '../context.js';

const translationMarkupPatterns = [
  /<\/?[a-z][^>]*>|<!--/i,
  /`|\*\*|__|~~|\]\(|\]\[/,
  /(?:^|\s)[*_]\S/,
  /^[ \t]*(?:#{1,6} |> |[-+*] |\d+[.)] )/m,
  /^\[[^\]\n]+\]:/m,
  /^(?:-{3,}|={3,})$/m,
];

interface ClaimRecord extends Located<
  Omit<CorpusEntry['claims'][number], 'section'>
> {
  entry: Pick<CorpusEntry, 'externalObjectIds'>;
  providers: Set<string>;
}

/**
 * checks each atomic claim against its evidence bindings and original text
 * @param context indexed corpus and diagnostic collector
 * @param record typed evidence and its owning diagnostic location
 */
export function validateClaim(
  context: CorpusContext,
  record: ClaimRecord,
): void {
  const { value: claim, entry, providers } = record;
  const location = (field: string): ClaimRecord => ({
    ...record,
    path: `${record.path}.${field}`,
  });
  unique(context, claim.citationIds, location('citationIds'));
  const citations = claim.citationIds.map((id, index) => {
    const citation = context.citations.get(id);
    context.check(
      citation !== undefined,
      { ...record, path: `${record.path}.citationIds[${index}]` },
      { code: 'claim_citation', message: 'Claim citation must exist' },
    );
    if (citation !== undefined) {
      context.check(
        entry.externalObjectIds.includes(citation.source.id),
        location('citationIds'),
        {
          code: 'claim_source_scope',
          message: 'Citation source must be bound to this entry',
        },
      );
      if (
        claim.supportState === 'cited' &&
        citation.value.relation === 'supports' &&
        citation.source.id !== inventorySourceId
      ) {
        providers.add(citation.source.provider);
      }
    }

    return citation;
  });
  context.check(
    claim.supportState !== 'cited' ||
      citations.some(
        (citation) =>
          citation?.value.relation === 'supports' &&
          context.locators.get(citation.value.locatorId)?.source.id ===
            citation.source.id,
      ),
    location('citationIds'),
    {
      code: 'claim_support',
      message: 'Cited claims require a source-bound supporting citation',
    },
  );
  (claim.scope.externalObjectIds ?? []).forEach((id) =>
    context.check(
      context.sources.has(id),
      location('scope.externalObjectIds'),
      { code: 'claim_scope', message: 'Scoped external object must exist' },
    ),
  );
  validateVariants(context, record);
}

/**
 * checks original identity, stale translations, language tags and plain text
 * @param context indexed corpus and diagnostic collector
 * @param record typed evidence and its owning diagnostic location
 */
function validateVariants(context: CorpusContext, record: ClaimRecord): void {
  const claim = record.value;
  const location = (field: string): ClaimRecord => ({
    ...record,
    path: `${record.path}.${field}`,
  });
  const originals = claim.variants.filter(
    (variant) => variant.kind === 'original',
  );
  context.check(
    originals.length === 1 &&
      originals[0]!.text === claim.originalText &&
      originals[0]!.language === claim.originalLanguage &&
      originals[0]!.method === 'original',
    location('variants'),
    {
      code: 'original_variant',
      message:
        'Exactly one original variant must match the claim text, language and method',
    },
  );
  context.check(
    Intl.getCanonicalLocales(claim.originalLanguage)[0] ===
      claim.originalLanguage,
    location('originalLanguage'),
    {
      code: 'canonical_language',
      message: 'Original language must use canonical BCP47 spelling',
    },
  );
  unique(
    context,
    claim.variants.map((variant) => `${variant.language}:${variant.kind}`),
    location('variants'),
  );
  validateVariantValues(context, record);
}

/**
 * checks variant hashes, canonical language tags and plain translation text
 * @param context indexed corpus and diagnostic collector
 * @param record typed claim and its owning diagnostic location
 */
function validateVariantValues(
  context: CorpusContext,
  record: ClaimRecord,
): void {
  record.value.variants.forEach((variant, index) => {
    const variantLocation = {
      ...record,
      path: `${record.path}.variants[${index}]`,
    };
    context.check(
      variant.sourceTextHash === sha256(record.value.originalText),
      { ...variantLocation, path: `${variantLocation.path}.sourceTextHash` },
      {
        code: 'variant_hash',
        message: 'Variant hash must match the original UTF-8 text',
      },
    );
    context.check(
      Intl.getCanonicalLocales(variant.language)[0] === variant.language,
      { ...variantLocation, path: `${variantLocation.path}.language` },
      {
        code: 'canonical_language',
        message: 'Variant language must use canonical BCP47 spelling',
      },
    );
    context.check(
      variant.kind !== 'translation' ||
        !translationMarkupPatterns.some((pattern) =>
          pattern.test(variant.text),
        ),
      { ...variantLocation, path: `${variantLocation.path}.text` },
      {
        code: 'translation_markup',
        message: 'Translations must be plain text without markup',
      },
    );
  });
}
