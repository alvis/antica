import { canonicalJson, sha256 } from './canonical.js';

import type { CorpusEntry, CorpusSource } from '@antica/contracts';

import type { CorpusContext } from './context.js';

/** entries and captured sources used to derive corpus citation coverage */
export interface CorpusInventoryInput {
  entries: readonly CorpusEntry[];
  sources: readonly CorpusSource[];
}

export const inventorySourceId = 'antica:source:inventory:institution-coverage';
export const inventoryPath = 'sources/antica/institution-coverage.json';
const inventoryLabel = 'Antica 語料庫清單';
const inventoryUrl =
  'https://github.com/alvis/antica/blob/feat/first-trial/07-knowledge/corpus/antica/v1/sources/antica/institution-coverage.json';
const capturedAt = '2026-10-20T00:00:00.000Z';
const coverageKey = 'single-institution-limit';
const scope =
  'Antica editorial inventory of citation coverage in this corpus only; not a museum statement, independent corroboration, or authentication.';

/**
 * generates a stable first-party snapshot from entry bindings rather than claim wording
 * @param input released entries and captured evidence sources
 * @returns canonically serializable inventory source with entry-specific fact locators
 */
export function createCorpusInventory(
  input: CorpusInventoryInput,
): CorpusSource {
  const sources = new Map(input.sources.map((source) => [source.id, source]));
  const citations = new Map(
    input.sources.flatMap((source) =>
      source.citations.map(
        (citation) => [citation.id, { citation, source }] as const,
      ),
    ),
  );
  const entries = [...input.entries]
    .sort((left, right) => left.id.localeCompare(right.id, 'en'))
    .map((entry) => {
      const sourceIds = entry.externalObjectIds
        .filter((id) => id !== inventorySourceId)
        .sort();
      const claims = entry.claims
        .filter((claim) => claim.claimKey !== coverageKey)
        .map((claim) => ({
          claimKey: claim.claimKey,
          ordinal: claim.ordinal,
          supportState: claim.supportState,
          citations: [...claim.citationIds].sort().map((id) => ({
            id,
            sourceId: citations.get(id)?.source.id ?? 'missing',
            provider: citations.get(id)?.source.provider ?? 'missing',
            relation: citations.get(id)?.citation.relation ?? 'missing',
          })),
        }))
        .sort(
          (left, right) =>
            left.claimKey.localeCompare(right.claimKey, 'en') ||
            left.ordinal - right.ordinal,
        );
      const supporting = claims
        .filter((claim) => claim.supportState === 'cited')
        .flatMap((claim) => claim.citations)
        .filter((citation) => citation.relation === 'supports');
      const providers = [
        ...new Set([
          ...sourceIds.map(
            (id) => sources.get(id)?.provider ?? `missing:${id}`,
          ),
          ...supporting.map((citation) => citation.provider),
        ]),
      ].sort();
      const statement =
        providers.length === 1 &&
        providers[0] === 'cleveland' &&
        supporting.length > 0
          ? 'This entry rests on records from a single institution, The Cleveland Museum of Art. Its subject-specific claims have not been independently corroborated by another institution in this draft.'
          : 'This inventory does not establish the single-institution Cleveland coverage limitation for this entry.';

      return { entryId: entry.id, sourceIds, providers, claims, statement };
    });
  const payload = { scope, entries };
  const payloadHash = sha256(canonicalJson(payload));
  const locators = entries.map((entry, index) => ({
    kind: 'structured' as const,
    id: `antica:locator:inventory:${entry.entryId}`,
    provider: inventoryLabel,
    objectId: 'institution-coverage',
    fieldPath: `/entries/${index}/statement`,
    valueHash: sha256(canonicalJson(entry.statement)),
    url: inventoryUrl,
    retrievedAt: capturedAt,
    excerpt: entry.statement,
  }));

  return {
    formatVersion: 1,
    kind: 'source',
    id: inventorySourceId,
    provider: inventoryLabel,
    objectId: 'institution-coverage',
    sourcePageUrl: inventoryUrl,
    title: inventoryLabel,
    languages: ['en'],
    contributors: [inventoryLabel],
    retrievedAt: capturedAt,
    payloadHash,
    providerSchemaVersion: 'antica-corpus-inventory/1',
    payload,
    rights: {
      holder: 'Antica',
      attribution: inventoryLabel,
      statement: scope,
      scope:
        'Antica-generated corpus inventory only; museum source rights remain with their original records.',
      observedAt: capturedAt,
      evidenceUrl: inventoryUrl,
    },
    fieldRights: [],
    locators,
    citations: entries.map((entry, index) => ({
      id: `antica:citation:inventory:${entry.entryId}`,
      sourceContentId: inventorySourceId,
      payloadHash,
      locatorId: locators[index]!.id,
      relation: 'supports',
      quote: entry.statement,
    })),
    images: [],
  };
}

/**
 * rejects stale, misattributed, missing, or misbound first-party coverage evidence
 * @param context indexed corpus and diagnostic collector
 */
export function validateCorpusInventory(context: CorpusContext): void {
  const coverageClaims = [...context.entries.values()].flatMap((entry) =>
    entry.value.claims
      .filter((claim) => claim.claimKey === coverageKey)
      .map((claim) => ({ entry, claim })),
  );
  const inventory = context.sources.get(inventorySourceId);
  if (inventory === undefined && coverageClaims.length === 0) {
    return;
  }
  const expected = createCorpusInventory({
    entries: [...context.entries.values()].map((entry) => entry.value),
    sources: [...context.sources.values()].map((source) => source.value),
  });
  context.check(
    inventory !== undefined &&
      canonicalJson(inventory.value) === canonicalJson(expected),
    { file: inventory?.file ?? inventoryPath, path: '$' },
    {
      code: 'corpus_inventory_drift',
      message:
        'Regenerate the Antica corpus inventory from the released entries and sources',
    },
  );
  for (const { entry, claim } of coverageClaims) {
    const citationId = `antica:citation:inventory:${entry.value.id}`;
    const expectedCitation = expected.citations.find(
      (citation) => citation.id === citationId,
    )!;
    context.check(
      claim.supportState === 'cited' &&
        claim.citationIds.length === 1 &&
        claim.citationIds[0] === citationId &&
        claim.originalText === expectedCitation.quote &&
        claim.qualifiers.attribution === inventoryLabel &&
        claim.qualifiers.editorialScope === scope,
      { ...entry, path: '$.claims' },
      {
        code: 'corpus_inventory_binding',
        message:
          'Coverage claims must cite their own entailing Antica inventory fact with Antica attribution',
      },
    );
  }
  for (const entry of context.entries.values()) {
    for (const claim of entry.value.claims.filter(
      (claim) => claim.claimKey !== coverageKey,
    )) {
      context.check(
        claim.citationIds.every(
          (id) => context.citations.get(id)?.source.id !== inventorySourceId,
        ),
        { ...entry, path: '$.claims' },
        {
          code: 'corpus_inventory_subject',
          message: 'Corpus inventory cannot support subject-specific claims',
        },
      );
    }
  }
}
