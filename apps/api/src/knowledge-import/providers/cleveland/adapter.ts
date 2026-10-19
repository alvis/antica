import {
  canonicalJsonSchema,
  importSelectionSchema,
  KnowledgeProviderError,
  providerCursorSchema,
} from '@antica/contracts';

import { canonicalJson, hash } from './canonical.js';
import { observeRights, readRecord } from './evidence.js';
import { mapClevelandSnapshot, parseModifiedAt } from './mapping.js';
import { createClevelandTransport } from './transport.js';

import type {
  CanonicalJson,
  ImportSelection,
  KnowledgeProviderAdapter,
  ObjectHandle,
  ProviderSnapshot,
} from '@antica/contracts';

import type { ClevelandTopicLabel } from './mapping.js';

/** configures captured taxonomy and bounded monthly rechecks */
export interface ClevelandAdapterOptions {
  readonly topics?: readonly ClevelandTopicLabel[];
  readonly updatedSince?: string;
  readonly request?: typeof fetch;
}

interface ListingContext {
  readonly version: string;
  readonly updatedSince?: string;
  readonly transport: ReturnType<typeof createClevelandTransport>;
}

type ListInput = Parameters<KnowledgeProviderAdapter['list']>[0];
type ListResult = Awaited<ReturnType<KnowledgeProviderAdapter['list']>>;
type FetchInput = Parameters<KnowledgeProviderAdapter['fetch']>[0];

const adapterVersion = 'cleveland-v1';
const apiUrl = 'https://openaccess-api.clevelandart.org/api/artworks/';
const versionHashLength = 12;
const httpNotModified = 304;
const httpNotFound = 404;
const typesByCategory = {
  ceramics: 'Ceramic',
  bronzes: 'Metalwork',
  jades: 'Jade',
  furniture: 'Furniture and woodwork',
};

/**
 * creates the reviewed metadata-only museum provider
 * @param options transport and immutable mapping configuration
 * @returns bounded versioned adapter
 * @throws {KnowledgeProviderError} when a recheck date is not ISO formatted
 */
export function createClevelandAdapter(
  options?: ClevelandAdapterOptions,
): KnowledgeProviderAdapter {
  const updatedSince = options?.updatedSince;
  if (
    updatedSince !== undefined &&
    (!/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(updatedSince) ||
      !Number.isFinite(Date.parse(updatedSince)))
  ) {
    throw new KnowledgeProviderError({
      code: 'INVALID_UPDATED_SINCE',
      retryable: false,
    });
  }
  const version =
    updatedSince === undefined
      ? adapterVersion
      : `${adapterVersion}:since:${hash(updatedSince).slice(0, versionHashLength)}`;
  const transport = createClevelandTransport(options?.request ?? fetch);
  const topics = options?.topics?.map((topic) => ({ ...topic })) ?? [];

  return {
    provider: 'cleveland',
    adapterVersion: version,
    list: async (input) =>
      listCleveland(input, { version, updatedSince, transport }),
    fetch: async (input) => fetchCleveland(input, transport),
    map: (snapshot) => mapClevelandSnapshot(snapshot, topics),
  };
}

/**
 * bounds pagination and binds it to the approved selection and adapter version
 * @param input approved selection, cursor and cancellation
 * @param context configured provider identity and transport
 * @returns bounded handles and the next opaque provider position
 * @throws {KnowledgeProviderError} when the selection is invalid
 */
async function listCleveland(
  input: ListInput,
  context: ListingContext,
): Promise<ListResult> {
  const selection = importSelectionSchema.parse(input.selection);
  if (
    selection.provider !== 'cleveland' ||
    !Number.isInteger(input.limit) ||
    input.limit < 1
  ) {
    throw new KnowledgeProviderError({
      code: 'INVALID_SELECTION',
      retryable: false,
    });
  }
  const queryHash = hash(canonicalJson(selection));
  validateCursor(input, { version: context.version, queryHash });
  input.signal.throwIfAborted();
  const offset = input.cursor?.offset ?? 0;
  const limit = Math.min(input.limit, selection.maxObjects - offset);
  const objects =
    selection.kind === 'ids'
      ? listIdentifiers(selection, { offset, limit })
      : await listQuery({ ...input, selection }, { ...context, offset, limit });
  const total =
    selection.kind === 'ids'
      ? selection.objectIds.length
      : selection.maxObjects;
  const hasMore = objects.length === limit && offset + objects.length < total;

  return {
    objects,
    next: hasMore
      ? {
          version: 1,
          schemaVersion: 2,
          queryHash,
          adapterVersion: context.version,
          offset: offset + objects.length,
        }
      : undefined,
  };
}

/**
 * rejects incompatible persisted positions before any provider request
 * @param input caller-provided provider cursor
 * @param context immutable mapper and query identity
 * @param context.version configured adapter identity
 * @param context.queryHash approved selection hash
 * @throws {KnowledgeProviderError} when a checkpoint needs an explicit restart
 */
function validateCursor(
  input: ListInput,
  context: { readonly version: string; readonly queryHash: string },
): void {
  const cursor = input.cursor;
  if (
    cursor &&
    (!providerCursorSchema.safeParse(cursor).success ||
      cursor.adapterVersion !== context.version ||
      cursor.queryHash !== context.queryHash ||
      (cursor.offset ?? 0) >= input.selection.maxObjects)
  ) {
    throw new KnowledgeProviderError({
      code: 'RESTART_REQUIRED',
      retryable: false,
    });
  }
}

/**
 * validates every approved identifier before slicing a local manifest page
 * @param selection explicit approved identities
 * @param context bounded page position
 * @param context.offset first selected identity
 * @param context.limit maximum returned identities
 * @returns local artwork handles without HTTP
 */
function listIdentifiers(
  selection: Extract<ImportSelection, { kind: 'ids' }>,
  context: { readonly offset: number; readonly limit: number },
): ObjectHandle[] {
  selection.objectIds.forEach(validateObjectId);

  return selection.objectIds
    .slice(context.offset, context.offset + context.limit)
    .map((objectId) => ({ objectId }));
}

/**
 * queries a bounded Chinese collection category with an explicit keyword
 * @param input selected category, keyword and cancellation
 * @param context provider configuration and bounded page position
 * @returns validated artwork handles for the frozen manifest
 * @throws {KnowledgeProviderError} when query bounds or upstream metadata are invalid
 */
async function listQuery(
  input: ListInput & {
    readonly selection: Extract<ImportSelection, { kind: 'query' }>;
  },
  context: ListingContext & { readonly offset: number; readonly limit: number },
): Promise<ObjectHandle[]> {
  if (!input.selection.query.category || !input.selection.query.text?.trim()) {
    throw new KnowledgeProviderError({
      code: 'INVALID_SELECTION',
      retryable: false,
    });
  }
  const url = new URL(apiUrl);
  url.search = new URLSearchParams({
    q: input.selection.query.text,
    type: typesByCategory[input.selection.query.category],
    department: 'Chinese Art',
    skip: String(context.offset),
    limit: String(context.limit),
    orderby: 'id ASC',
    fields: 'id',
  }).toString();
  if (context.updatedSince !== undefined) {
    url.searchParams.set('updated_since', context.updatedSince);
  }
  const response = await context.transport({ url, signal: input.signal });
  const payload = canonicalJsonSchema.parse(response.body);
  if (
    !payload ||
    typeof payload !== 'object' ||
    Array.isArray(payload) ||
    !('data' in payload) ||
    !Array.isArray(payload.data) ||
    payload.data.length > context.limit
  ) {
    throw new KnowledgeProviderError({
      code: 'INVALID_RESPONSE',
      retryable: false,
    });
  }

  return (payload.data as readonly CanonicalJson[]).map(readHandle);
}

/**
 * validates list-response identities before using them as detail fetch paths
 * @param record upstream list record
 * @returns validated decimal artwork identity
 * @throws {KnowledgeProviderError} when upstream omits a valid numeric identity
 */
function readHandle(record: CanonicalJson): ObjectHandle {
  if (
    !record ||
    typeof record !== 'object' ||
    Array.isArray(record) ||
    !('id' in record) ||
    typeof record.id !== 'number'
  ) {
    throw new KnowledgeProviderError({
      code: 'INVALID_RESPONSE',
      retryable: false,
    });
  }
  const objectId = String(record.id);
  validateObjectId(objectId);

  return { objectId };
}

/**
 * captures one approved artwork or its conditional status
 * @param input selected identity, conditional token and cancellation
 * @param transport globally serialized metadata capability
 * @returns exact canonical snapshot, unchanged marker or missing marker
 * @throws {KnowledgeProviderError} when the upstream object identity or page is invalid
 */
async function fetchCleveland(
  input: FetchInput,
  transport: ListingContext['transport'],
): ReturnType<KnowledgeProviderAdapter['fetch']> {
  validateObjectId(input.object.objectId);
  const response = await transport({
    url: new URL(input.object.objectId, apiUrl),
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
    typeof record.id !== 'number' ||
    String(record.id) !== input.object.objectId ||
    typeof record.url !== 'string' ||
    !/^https?:\/\//.test(record.url)
  ) {
    throw new KnowledgeProviderError({
      code: 'INVALID_RESPONSE',
      retryable: false,
    });
  }
  if (
    input.etag !== undefined &&
    (input.etag === record.updated_at ||
      input.etag === parseModifiedAt(record.updated_at) ||
      input.etag === response.etag)
  ) {
    return { kind: 'unchanged' };
  }
  const payloadHash = hash(canonicalJson(payload));
  const snapshot: ProviderSnapshot = {
    provider: 'cleveland',
    objectId: input.object.objectId,
    schemaVersion: adapterVersion,
    payloadHash,
    sourceHash: hash(
      canonicalJson({
        provider: 'cleveland',
        objectId: input.object.objectId,
        payloadHash,
        schemaVersion: adapterVersion,
      }),
    ),
    sourcePageUrl: record.url,
    retrievedAt: new Date().toISOString(),
    payload,
  };

  return {
    kind: 'snapshot',
    value: { ...snapshot, observedRights: observeRights(snapshot) },
  };
}

/**
 * prevents identifiers from becoming arbitrary fetch paths
 * @param objectId approved positive decimal artwork identity
 * @throws {KnowledgeProviderError} when an identity cannot name an artwork
 */
function validateObjectId(objectId: string): void {
  if (!/^[1-9]\d*$/.test(objectId) || !Number.isSafeInteger(Number(objectId))) {
    throw new KnowledgeProviderError({
      code: 'INVALID_OBJECT_ID',
      retryable: false,
    });
  }
}
