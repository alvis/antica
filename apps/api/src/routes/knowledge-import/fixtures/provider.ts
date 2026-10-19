import { ok } from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { KnowledgeProviderError } from '@antica/contracts';

import type {
  KnowledgeProviderAdapter,
  MappedObject,
  ProviderFetchResult,
  ProviderSnapshot,
} from '@antica/contracts';

/** deterministic provider responses, including recoverable boundary failures */
export interface ProviderFixtureOptions {
  readonly snapshots: readonly ProviderSnapshot[];
  readonly pageSize?: number;
  readonly outcomes?: Readonly<
    Record<string, ReadonlyArray<ProviderFetchResult | KnowledgeProviderError>>
  >;
  readonly onFetch?: () => Promise<void>;
}

/** validated captured fields used by the deterministic mapper */
interface FixturePayload {
  readonly title: string;
  readonly images: readonly string[];
}

const defaultPageSize = 50;

export const instant = '2026-10-19T00:00:00.000Z';

/**
 * creates a test-only provider with deterministic pages and per-object responses
 * @param options immutable snapshots, scripted responses and optional fetch barrier
 * @returns adapter with an observable fetch receipt list
 */
export function createProviderFixture(
  options: ProviderFixtureOptions,
): KnowledgeProviderAdapter & { readonly fetched: string[] } {
  const pageSize = options.pageSize ?? defaultPageSize;
  const fetched: string[] = [];
  const attempts = new Map<string, number>();

  return {
    provider: 'fixture',
    adapterVersion: 'fixture-v1',
    fetched,
    list: async (input) => listFixturePage(options, input, pageSize),
    fetch: async ({ object }) => {
      fetched.push(object.objectId);
      await options.onFetch?.();
      const attempt = attempts.get(object.objectId) ?? 0;
      attempts.set(object.objectId, attempt + 1);
      const sequence = options.outcomes?.[object.objectId];
      const outcome = sequence?.[Math.min(attempt, sequence.length - 1)];
      if (outcome instanceof KnowledgeProviderError) {
        throw outcome;
      }
      if (outcome) {
        return outcome;
      }
      const snapshot = options.snapshots.find(
        ({ objectId }) => objectId === object.objectId,
      );

      ok(snapshot, `No fixture outcome for ${object.objectId}`);

      return { kind: 'snapshot', value: snapshot };
    },
    map: mapSnapshot,
  };
}

/**
 * slices a deterministic page bound to the approved query identity
 * @param options immutable provider snapshot collection
 * @param input selection and last provider cursor
 * @param pageSize resolved provider page size
 * @returns bounded object handles and next cursor
 */
function listFixturePage(
  options: ProviderFixtureOptions,
  input: Parameters<KnowledgeProviderAdapter['list']>[0],
  pageSize: number,
): Awaited<ReturnType<KnowledgeProviderAdapter['list']>> {
  const { cursor, limit, selection } = input;
  const offset = cursor?.offset ?? 0;
  const objects = options.snapshots
    .slice(offset, offset + Math.min(limit, pageSize))
    .map(({ objectId }) => ({ objectId }));
  const nextOffset = offset + objects.length;

  return {
    objects,
    ...(nextOffset < options.snapshots.length
      ? {
          next: {
            version: 1 as const,
            schemaVersion: 2 as const,
            adapterVersion: 'fixture-v1',
            queryHash:
              cursor?.queryHash ??
              hash(
                JSON.stringify(selection, [
                  'category',
                  'deadline',
                  'kind',
                  'maxBytes',
                  'maxObjects',
                  'objectIds',
                  'provider',
                  'query',
                  'text',
                ]),
              ),
            offset: nextOffset,
          },
        }
      : {}),
  };
}

/**
 * captures a canonical JSON fixture with every alternative image URL
 * @param objectId reviewed provider identifier
 * @param title mutable upstream metadata for changed-payload tests
 * @returns immutable structured snapshot
 */
export function createSnapshot(
  objectId = 'object-1',
  title = '青花瓷瓶',
): ProviderSnapshot {
  const payload = {
    title,
    images: [
      `https://images.example.invalid/${objectId}.jpg?size=small`,
      `https://images.example.invalid/${objectId}.jpg?size=full`,
      `https://images.example.invalid/${objectId}-reverse.jpg`,
    ],
  };
  const payloadHash = hash(JSON.stringify(payload, ['images', 'title']));

  return {
    provider: 'fixture',
    objectId,
    payloadHash,
    sourceHash: hash(
      JSON.stringify({
        objectId,
        payloadHash,
        provider: 'fixture',
        schemaVersion: 'fixture-v1',
      }),
    ),
    schemaVersion: 'fixture-v1',
    retrievedAt: instant,
    sourcePageUrl: `https://catalog.example.invalid/${objectId}`,
    payload,
    observedRights: [
      {
        statement: 'Fixture metadata only',
        observedAt: instant,
        evidenceUrl: `https://catalog.example.invalid/${objectId}`,
      },
    ],
  };
}

/**
 * maps captured evidence without IO or mutation
 * @param snapshot exact provider response
 * @returns pending v2 object example with pinned structured evidence
 */
function mapSnapshot(snapshot: ProviderSnapshot): MappedObject {
  const payload = snapshot.payload;
  ok(
    payload &&
      typeof payload === 'object' &&
      !Array.isArray(payload) &&
      'title' in payload &&
      typeof payload.title === 'string' &&
      'images' in payload &&
      Array.isArray(payload.images) &&
      payload.images.every((url) => typeof url === 'string'),
    'Invalid fixture snapshot',
  );
  const source = {
    id: stableId(`${snapshot.objectId}:source`),
    versionId: stableId(`${snapshot.objectId}:${snapshot.payloadHash}:version`),
    title: payload.title,
    canonicalUrl: snapshot.sourcePageUrl,
    languages: ['zh-Hant'],
    contributors: [],
    structuredSnapshot: snapshot,
  };

  return {
    externalObject: {
      provider: snapshot.provider,
      objectId: snapshot.objectId,
      canonicalRecordUrl: snapshot.sourcePageUrl,
    },
    source,
    draft: createDraft(source, snapshot, {
      title: payload.title,
      images: payload.images,
    }),
  };
}

/**
 * composes a draft from captured evidence without adding reviewed claims
 * @param source pinned source identity
 * @param snapshot captured provider evidence
 * @param payload validated title and all image URLs
 * @returns pending v2 content
 */
function createDraft(
  source: MappedObject['source'],
  snapshot: ProviderSnapshot,
  payload: FixturePayload,
): MappedObject['draft'] {
  const citationId = stableId(`${source.versionId}:citation`);
  const locatorId = stableId(`${source.versionId}:locator`);
  const text = `館藏目錄稱此器為「${payload.title}」。`;

  return {
    contentSchemaVersion: 2,
    entryType: 'object_example',
    origin: 'open_import',
    titles: [{ language: 'zh-Hant', text: payload.title }],
    aliases: [],
    editorialReview: { state: 'pending' },
    sections: {
      summary: {
        claimKey: 'title',
        text,
        citationIds: [citationId],
        supportState: 'cited',
      },
      history: [],
      features: [],
      applicability: [],
      limits: [],
    },
    claims: [createClaim(text, citationId)],
    citations: [createCitation(source, snapshot, payload.title)],
    images: payload.images.map((imageUrl, index) => ({
      id: stableId(`${source.versionId}:image:${index}`),
      sourceVersionId: source.versionId,
      imageUrl,
      sourcePageUrl: snapshot.sourcePageUrl,
      provider: snapshot.provider,
      status: 'unchecked',
      locatorId,
    })),
    topics: [],
    methodIds: [],
    relatedEntryIds: [],
  };
}

/**
 * records the attributed title as an unreviewed original-language claim
 * @param text attributed museum wording
 * @param citationId exact source evidence
 * @returns granular pending claim
 */
function createClaim(
  text: string,
  citationId: string,
): MappedObject['draft']['claims'][number] {
  return {
    claimKey: 'title',
    section: 'summary',
    ordinal: 0,
    originalText: text,
    originalLanguage: 'zh-Hant',
    statementType: 'source_attribution',
    scope: {},
    qualifiers: {},
    supportState: 'cited',
    citationIds: [citationId],
    review: { state: 'pending' },
    variants: [
      {
        language: 'zh-Hant',
        kind: 'original',
        text,
        method: 'original',
        sourceTextHash: hash(text),
        review: { state: 'pending' },
      },
    ],
  };
}

/**
 * pins an exact quotation to its captured JSON pointer
 * @param source immutable source identity
 * @param snapshot captured provider evidence
 * @param title exact title field
 * @returns fully located citation
 */
function createCitation(
  source: MappedObject['source'],
  snapshot: ProviderSnapshot,
  title: string,
): MappedObject['draft']['citations'][number] {
  const citationId = stableId(`${source.versionId}:citation`);
  const locatorId = stableId(`${source.versionId}:locator`);

  return {
    id: citationId,
    relation: 'supports',
    availability: 'stored',
    verification: 'located',
    quote: title,
    source,
    locator: {
      id: locatorId,
      kind: 'structured',
      sourceId: source.id,
      sourceVersionId: source.versionId,
      provider: snapshot.provider,
      objectId: snapshot.objectId,
      fieldPath: '/title',
      valueHash: hash(JSON.stringify(title)),
      url: snapshot.sourcePageUrl,
      retrievedAt: snapshot.retrievedAt,
      excerpt: title,
    },
  };
}

/**
 * hashes fixture text consistently with exact structured values
 * @param value text to hash
 * @returns SHA-256 hexadecimal identity
 */
function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * derives stable UUIDs for source evidence
 * @param value scoped fixture identity
 * @returns deterministic UUID
 */
function stableId(value: string): string {
  return hash(value).replace(
    /^(.{8})(.{4}).(.{3}).(.{3})(.{12}).*$/,
    '$1-$2-4$3-8$4-$5',
  );
}
