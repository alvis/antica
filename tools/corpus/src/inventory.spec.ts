import { describe, expect, it } from 'vitest';

import { corpusFileSchema } from '@antica/contracts';

import { canonicalJson, sha256 } from './canonical.js';
import { CorpusContext, indexFile } from './context.js';
import { validateEntries } from './entries.js';
import { createCorpusFixture } from './fixtures/corpus.js';
import {
  createCorpusInventory,
  inventoryPath,
  inventorySourceId,
  validateCorpusInventory,
} from './inventory.js';

import type { CorpusEntry, CorpusSource } from '@antica/contracts';

import type { CorpusInventoryInput } from './inventory.js';

const coverageText =
  'This entry rests on records from a single institution, The Cleveland Museum of Art. Its subject-specific claims have not been independently corroborated by another institution in this draft.';
const editorialScope =
  'Antica editorial inventory of citation coverage in this corpus only; not a museum statement, independent corroboration, or authentication.';

describe('fn: createCorpusInventory', () => {
  it('should produce identical bytes regardless of input order without changing its inputs', () => {
    const input = createInput();
    input.entries[0]!.externalObjectIds.push(input.sources[1]!.id);
    input.entries[0]!.claims.push({
      ...input.entries[0]!.claims[0]!,
      claimKey: 'another-claim',
      ordinal: 1,
      citationIds: input.sources.map((source) => source.citations[0]!.id),
    });
    const before = canonicalJson(input);
    const reordered = {
      entries: [...input.entries].reverse().map((entry) => ({
        ...entry,
        externalObjectIds: [...entry.externalObjectIds].reverse(),
        claims: [...entry.claims].reverse().map((claim) => ({
          ...claim,
          citationIds: [...claim.citationIds].reverse(),
        })),
      })),
      sources: [...input.sources].reverse(),
    };
    expect(canonicalJson(createCorpusInventory(input))).toBe(
      canonicalJson(createCorpusInventory(reordered)),
    );
    expect(canonicalJson(input)).toBe(before);
  });

  it('should derive the fact from source coverage even when the claim wording is forged', () => {
    const input = createInput();
    input.entries[0]!.claims.push(createCoverageClaim(input.entries[0]!));
    input.entries[0]!.claims.at(-1)!.originalText =
      'Authenticated by three museums';
    const inventory = createCorpusInventory(input);
    expect(inventory.citations[0]!.quote).toBe(coverageText);
    expect(canonicalJson(inventory)).not.toContain(
      'Authenticated by three museums',
    );
    expect(inventory).toMatchObject({
      provider: 'Antica 語料庫清單',
      title: 'Antica 語料庫清單',
      contributors: ['Antica 語料庫清單'],
      rights: { holder: 'Antica', attribution: 'Antica 語料庫清單' },
    });
  });

  it('should stop claiming single-institution coverage after a second provider supports a subject claim', () => {
    const input = createInput();
    input.entries[0]!.claims[0]!.citationIds.push(
      input.sources[1]!.citations[0]!.id,
    );
    const inventory = createCorpusInventory(input);
    expect(inventory.citations[0]!.quote).not.toBe(coverageText);
    expect(inventory.payload).toMatchObject({
      entries: [
        { entryId: input.entries[0]!.id, providers: ['beta', 'cleveland'] },
        { entryId: input.entries[1]!.id, providers: ['beta'] },
      ],
    });
  });
});

describe('fn: validateCorpusInventory', () => {
  it('should accept entry-specific evidence and its literal attributed coverage claim', () => {
    const input = createInput();
    input.entries[0]!.claims.push(createCoverageClaim(input.entries[0]!));
    const inventory = createCorpusInventory(input);
    const context = createContext(input, inventory);
    validateCorpusInventory(context);
    expect(context.issues).toEqual([]);
  });

  it('should reject a missing inventory when an entry claims its coverage fact', () => {
    const input = createInput();
    input.entries[0]!.claims.push(createCoverageClaim(input.entries[0]!));
    const context = createContext(input);
    validateCorpusInventory(context);
    expect(context.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'corpus_inventory_drift',
          file: inventoryPath,
        }),
      ]),
    );
  });

  it.each(['source binding', 'subject citation'] as const)(
    'should detect stale %s even when the existing snapshot hashes are internally valid',
    (change) => {
      const input = createInput();
      const inventory = createCorpusInventory(input);
      if (change === 'source binding') {
        input.entries[0]!.externalObjectIds.push(input.sources[1]!.id);
      } else {
        input.entries[0]!.claims[0]!.citationIds.push(
          input.sources[1]!.citations[0]!.id,
        );
      }
      const context = createContext(input, inventory);
      validateCorpusInventory(context);
      expect(context.issues.map((issue) => issue.code)).toContain(
        'corpus_inventory_drift',
      );
    },
  );

  it('should reject forged payload facts after payload, locator and citation hashes are recomputed', () => {
    const input = createInput();
    const forged = 'Independently authenticated by three museums';
    const inventory = corpusFileSchema.parse(
      JSON.parse(
        canonicalJson(createCorpusInventory(input)).replaceAll(
          coverageText,
          forged,
        ),
      ),
    );
    if (inventory.kind !== 'source') {
      throw new Error('Expected generated source evidence');
    }
    inventory.payloadHash = sha256(canonicalJson(inventory.payload));
    for (const locator of inventory.locators) {
      if (locator.kind === 'structured') {
        locator.valueHash = sha256(canonicalJson(locator.excerpt));
      }
    }
    inventory.citations = inventory.citations.map((citation) => ({
      ...citation,
      payloadHash: inventory.payloadHash,
    }));
    const context = createContext(input, inventory);
    validateCorpusInventory(context);
    expect(context.issues.map((issue) => issue.code)).toContain(
      'corpus_inventory_drift',
    );
  });

  it.each(['wrong entry', 'false attribution', 'nonliteral fact'] as const)(
    'should reject a coverage claim with %s',
    (change) => {
      const input = createInput();
      const claim = createCoverageClaim(input.entries[0]!);
      if (change === 'wrong entry') {
        input.entries[1]!.externalObjectIds = [
          ...input.entries[0]!.externalObjectIds,
        ];
        input.entries[1]!.claims[0]!.citationIds = [
          ...input.entries[0]!.claims[0]!.citationIds,
        ];
        claim.citationIds = [
          `antica:citation:inventory:${input.entries[1]!.id}`,
        ];
      } else if (change === 'false attribution') {
        claim.qualifiers.attribution = 'The Cleveland Museum of Art';
      } else {
        claim.originalText = 'This object is independently authenticated';
      }
      input.entries[0]!.claims.push(claim);
      const context = createContext(input, createCorpusInventory(input));
      validateCorpusInventory(context);
      expect(context.issues.map((issue) => issue.code)).toContain(
        'corpus_inventory_binding',
      );
    },
  );

  it('should reject inventory evidence used to support a subject claim', () => {
    const input = createInput();
    input.entries[0]!.claims[0]!.citationIds = [
      `antica:citation:inventory:${input.entries[0]!.id}`,
    ];
    const context = createContext(input, createCorpusInventory(input));
    validateCorpusInventory(context);
    expect(context.issues.map((issue) => issue.code)).toContain(
      'corpus_inventory_subject',
    );
  });

  it('should exclude Antica inventory from the independent-provider minimum', () => {
    const input = createInput();
    const entry = input.entries[0]!;
    entry.claims.push(createCoverageClaim(entry));
    entry.externalObjectIds.push(inventorySourceId);
    const scoped = { ...input, entries: [entry] };
    const context = createContext(scoped, createCorpusInventory(scoped));
    validateEntries(context, 2);
    expect(context.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'provider_minimum',
          file: 'entries/ceramics',
        }),
      ]),
    );
  });
});

/** @returns fresh synthetic entries and their two independent providers */
function createInput(): CorpusInventoryInput {
  const files = createCorpusFixture().map((document) =>
    corpusFileSchema.parse(JSON.parse(document.text)),
  );
  const entries = files
    .filter((file): file is CorpusEntry => file.kind === 'entry')
    .slice(0, 2);
  const sources = files
    .filter((file): file is CorpusSource => file.kind === 'source')
    .slice(0, 2);
  sources[0]!.provider = 'cleveland';

  return { entries, sources };
}

/**
 * @param entry subject whose coverage is asserted
 * @returns independently specified, literally quoted coverage claim
 */
function createCoverageClaim(
  entry: CorpusEntry,
): CorpusEntry['claims'][number] {
  return {
    ...entry.claims[0]!,
    claimKey: 'single-institution-limit',
    ordinal: 1,
    originalText: coverageText,
    qualifiers: { attribution: 'Antica 語料庫清單', editorialScope },
    citationIds: [`antica:citation:inventory:${entry.id}`],
    variants: [
      {
        ...entry.claims[0]!.variants[0]!,
        text: coverageText,
        sourceTextHash: sha256(coverageText),
      },
    ],
  };
}

/**
 * @param input current entries and source evidence
 * @param inventory captured inventory when present
 * @returns indexed fixture with a real diagnostic collector
 */
function createContext(
  input: CorpusInventoryInput,
  inventory?: CorpusSource,
): CorpusContext {
  const context = new CorpusContext([]);
  const files = [
    ...input.entries,
    ...input.sources,
    ...(inventory === undefined ? [] : [inventory]),
  ];
  for (const file of files) {
    indexFile(context, {
      file: file.id === inventorySourceId ? inventoryPath : `${file.id}.json`,
      path: '$',
      value: file,
    });
  }

  return context;
}
