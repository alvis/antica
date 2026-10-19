import {
  canonicalJsonSchema,
  importSelectionSchema,
  KnowledgeProviderError,
  providerCursorSchema,
} from '@antica/contracts';

import { canonicalJson, hash } from './canonical.js';
import { observeRights, readRecord } from './evidence.js';
import { mapMetSnapshot, parseModifiedAt } from './mapping.js';
import { createMetTransport } from './transport.js';

import type {
  CanonicalJson,
  ImportSelection,
  KnowledgeProviderAdapter,
  ObjectHandle,
  ProviderSnapshot,
} from '@antica/contracts';

import type { MetTopicLabel } from './mapping.js';

/** configures captured owner taxonomy and the serial metadata transport */
export interface MetAdapterOptions {
  readonly topics?: readonly MetTopicLabel[];
  readonly request?: typeof fetch;
}

interface ListingContext {
  readonly transport: ReturnType<typeof createMetTransport>;
  readonly offset: number;
  readonly limit: number;
}

interface ListedPage {
  readonly objects: ObjectHandle[];
  readonly total: number;
}

type ListInput = Parameters<KnowledgeProviderAdapter['list']>[0];
type ListResult = Awaited<ReturnType<KnowledgeProviderAdapter['list']>>;
type FetchInput = Parameters<KnowledgeProviderAdapter['fetch']>[0];

const adapterVersion = 'met-v1';
const detailUrl =
  'https://collectionapi.metmuseum.org/public/collection/v1/objects/';
const searchUrl =
  'https://collectionapi.metmuseum.org/public/collection/v1.1/search';
const maximumPageSize = 500;
const httpNotModified = 304;
const httpNotFound = 404;
const mediaByCategory = {
  ceramics: 'Ceramics',
  bronzes: 'Bronze',
  jades: 'Jade',
  furniture: 'Wood',
};

/**
 * creates the reviewed metadata-only Met provider
 * @param options transport and immutable taxonomy configuration
 * @returns bounded versioned adapter
 */
export function createMetAdapter(
  options?: MetAdapterOptions,
): KnowledgeProviderAdapter {
  const transport = createMetTransport(options?.request ?? fetch);
  const topics = options?.topics?.map((topic) => ({ ...topic })) ?? [];

  return {
    provider: 'met',
    adapterVersion,
    list: async (input) => listMet(input, transport),
    fetch: async (input) => fetchMet(input, transport),
    map: (snapshot) => mapMetSnapshot(snapshot, topics),
  };
}

/**
 * bounds provider listing and binds every position to the immutable selection
 * @param input approved selection, cursor and cancellation
 * @param transport shared serial metadata capability
 * @returns bounded handles for the framework's frozen manifest
 * @throws {KnowledgeProviderError} when the approved selection is invalid
 */
async function listMet(
  input: ListInput,
  transport: ListingContext['transport'],
): Promise<ListResult> {
  const parsed = importSelectionSchema.safeParse(input.selection);
  if (
    !parsed.success ||
    parsed.data.provider !== 'met' ||
    !Number.isInteger(input.limit) ||
    input.limit < 1
  ) {
    throw new KnowledgeProviderError({
      code: 'INVALID_SELECTION',
      retryable: false,
    });
  }
  const selection = parsed.data;
  const queryHash = hash(canonicalJson(selection));
  validateCursor(input, queryHash);
  input.signal.throwIfAborted();
  const offset = input.cursor?.offset ?? 0;
  if (offset === selection.maxObjects) {
    return { objects: [] };
  }
  const limit = Math.min(
    input.limit,
    maximumPageSize,
    selection.maxObjects - offset,
  );
  const page =
    selection.kind === 'ids'
      ? listIdentifiers(selection, { offset, limit })
      : await listQuery({ ...input, selection }, { transport, offset, limit });
  const nextOffset = offset + page.objects.length;

  return {
    objects: page.objects,
    next:
      page.objects.length === limit &&
      nextOffset < Math.min(page.total, selection.maxObjects)
        ? {
            version: 1,
            schemaVersion: 2,
            queryHash,
            adapterVersion,
            offset: nextOffset,
          }
        : undefined,
  };
}

/**
 * rejects stale provider positions before any HTTP request
 * @param input approved selection and supplied cursor
 * @param queryHash immutable selection identity
 * @throws {KnowledgeProviderError} when the cursor requires an explicit restart
 */
function validateCursor(input: ListInput, queryHash: string): void {
  const cursor = input.cursor;
  if (
    cursor &&
    (!providerCursorSchema.safeParse(cursor).success ||
      cursor.adapterVersion !== adapterVersion ||
      cursor.queryHash !== queryHash ||
      (cursor.offset ?? 0) > input.selection.maxObjects)
  ) {
    throw new KnowledgeProviderError({
      code: 'RESTART_REQUIRED',
      retryable: false,
    });
  }
}

/**
 * validates approved IDs before slicing their local manifest page
 * @param selection explicit decimal object identities
 * @param context bounded page position
 * @param context.offset first approved identity
 * @param context.limit maximum returned identities
 * @returns local handles without HTTP
 */
function listIdentifiers(
  selection: Extract<ImportSelection, { kind: 'ids' }>,
  context: Pick<ListingContext, 'offset' | 'limit'>,
): ListedPage {
  selection.objectIds.forEach(validateObjectId);

  return {
    objects: selection.objectIds
      .slice(context.offset, context.offset + context.limit)
      .map((objectId) => ({ objectId })),
    total: selection.objectIds.length,
  };
}

/**
 * queries current paginated search within the approved Chinese collection scope
 * @param input bounded query and cancellation
 * @param context serial transport and page bounds
 * @returns validated object IDs and full upstream result count
 * @throws {KnowledgeProviderError} when the query or response is malformed
 */
async function listQuery(
  input: ListInput & {
    readonly selection: Extract<ImportSelection, { kind: 'query' }>;
  },
  context: ListingContext,
): Promise<ListedPage> {
  const query = input.selection.query;
  if (query.text !== undefined && !query.text.trim()) {
    throw new KnowledgeProviderError({
      code: 'INVALID_SELECTION',
      retryable: false,
    });
  }
  const url = new URL(searchUrl);
  url.search = new URLSearchParams({
    q: query.text?.trim() ?? mediaByCategory[query.category!],
    geoLocation: 'China',
    departmentId: '6',
    offset: String(context.offset),
    limit: String(context.limit),
  }).toString();
  if (query.category) {
    url.searchParams.set('medium', mediaByCategory[query.category]);
  }
  const response = await context.transport({ url, signal: input.signal });
  const record = readRecord(canonicalJsonSchema.parse(response.body));
  const total = record.total;
  const ids = record.objectIDs;
  if (
    typeof total !== 'number' ||
    !Number.isSafeInteger(total) ||
    total < 0 ||
    !(Array.isArray(ids) || (ids === null && total === 0)) ||
    (Array.isArray(ids) && ids.length > context.limit)
  ) {
    throw new KnowledgeProviderError({
      code: 'INVALID_RESPONSE',
      retryable: false,
    });
  }

  return { objects: (ids ?? []).map(readHandle), total };
}

/**
 * validates upstream IDs before using them in detail request paths
 * @param value one returned objectID
 * @returns validated decimal handle
 * @throws {KnowledgeProviderError} when upstream omits a numeric ID
 */
function readHandle(value: CanonicalJson): ObjectHandle {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new KnowledgeProviderError({
      code: 'INVALID_RESPONSE',
      retryable: false,
    });
  }

  return { objectId: String(value) };
}

/**
 * captures one approved object or reports a missing or unchanged response
 * @param input approved identity, conditional token and cancellation
 * @param transport shared serial metadata capability
 * @returns canonical response or conditional status
 * @throws {KnowledgeProviderError} when the response identity or page URL is invalid
 */
async function fetchMet(
  input: FetchInput,
  transport: ListingContext['transport'],
): ReturnType<KnowledgeProviderAdapter['fetch']> {
  validateObjectId(input.object.objectId);
  const response = await transport({
    url: new URL(input.object.objectId, detailUrl),
    signal: input.signal,
    etag: input.etag,
  });
  if (response.status === httpNotFound) {
    return { kind: 'missing' };
  }
  if (response.status === httpNotModified) {
    return { kind: 'unchanged' };
  }
  const payload = canonicalJsonSchema.parse(response.body);
  const record = readRecord(payload);
  if (
    typeof record.objectID !== 'number' ||
    String(record.objectID) !== input.object.objectId ||
    typeof record.objectURL !== 'string' ||
    !/^https?:\/\//.test(record.objectURL)
  ) {
    throw new KnowledgeProviderError({
      code: 'INVALID_RESPONSE',
      retryable: false,
    });
  }
  const payloadHash = hash(canonicalJson(payload));
  const dateTokens = [
    record.metadataDate,
    parseModifiedAt(record.metadataDate),
  ];
  if (
    input.etag !== undefined &&
    [...dateTokens, payloadHash, response.etag].includes(input.etag)
  ) {
    return { kind: 'unchanged' };
  }
  const identity = {
    provider: 'met' as const,
    objectId: input.object.objectId,
    schemaVersion: adapterVersion,
    payloadHash,
  };
  const snapshot: ProviderSnapshot = {
    ...identity,
    sourceHash: hash(canonicalJson(identity)),
    sourcePageUrl: record.objectURL,
    retrievedAt: new Date().toISOString(),
    payload,
  };

  return {
    kind: 'snapshot',
    value: { ...snapshot, observedRights: observeRights(snapshot) },
  };
}

/**
 * prevents approved identities from becoming arbitrary fetch paths
 * @param objectId positive decimal object identity
 * @throws {KnowledgeProviderError} when the ID cannot name a Met object
 */
function validateObjectId(objectId: string): void {
  if (!/^[1-9]\d*$/.test(objectId) || !Number.isSafeInteger(Number(objectId))) {
    throw new KnowledgeProviderError({
      code: 'INVALID_OBJECT_ID',
      retryable: false,
    });
  }
}
