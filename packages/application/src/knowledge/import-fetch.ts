import {
  KnowledgeProviderError,
  mappedObjectSchema,
  providerCursorSchema,
  providerSnapshotSchema,
} from '@antica/contracts';

import { providerError, retryTime, stopped } from './import-errors.js';

import type {
  ImportBatch,
  ImportBatchLease,
  ImportCheckpoint,
  ImportObjectResult,
  KnowledgeProviderAdapter,
} from '@antica/contracts';

import type { KnowledgeImportParams } from './import.js';

interface FetchContext {
  readonly params: KnowledgeImportParams;
  readonly lease: ImportBatchLease;
  readonly adapter: KnowledgeProviderAdapter;
  readonly signal: AbortSignal;
}
interface BatchProgress {
  readonly objects: ImportObjectResult[];
  bytes: number;
  offset: number;
  reason: string | null;
  retryAfter: string | null;
  stop: boolean;
}
const batchSize = 50;
const maximumIdentifierLength = 200;
const maximumObjectBytes = 262_144;
const maximumBatchBytes = 2_097_152;
const maximumAttempts = 3;

/**
 * freezes a bounded manifest before fetching objects
 * @param context claimed selection and reviewed adapter
 * @returns next manifest checkpoint
 */
async function listPage(context: FetchContext): Promise<ImportCheckpoint> {
  const { lease, adapter, signal } = context;
  const checkpoint = lease.checkpoint;
  if (checkpoint.listed) {
    return checkpoint;
  }
  const page = await adapter.list({
    selection: lease.run.selection,
    cursor: checkpoint.providerCursor,
    limit: Math.min(
      batchSize,
      lease.run.selection.maxObjects - checkpoint.manifest.length,
    ),
    signal,
  });
  const ids = page.objects.map((object) => object.objectId);
  if (
    ids.length > batchSize ||
    ids.some(
      (id) =>
        !id.length || id.length > maximumIdentifierLength || id.includes('://'),
    ) ||
    new Set([...checkpoint.manifest, ...ids]).size !==
      checkpoint.manifest.length + ids.length ||
    checkpoint.manifest.length + ids.length > lease.run.selection.maxObjects ||
    (page.next && !ids.length)
  ) {
    throw new KnowledgeProviderError({
      code: 'INVALID_MANIFEST',
      retryable: false,
    });
  }
  if (
    page.next &&
    (!providerCursorSchema.safeParse(page.next).success ||
      page.next.queryHash !== lease.run.queryHash ||
      page.next.adapterVersion !== lease.run.adapterVersion)
  ) {
    throw new KnowledgeProviderError({
      code: 'RESTART_REQUIRED',
      retryable: false,
    });
  }

  return {
    ...checkpoint,
    manifest: [...checkpoint.manifest, ...ids],
    listed:
      page.next === undefined ||
      checkpoint.manifest.length + ids.length ===
        lease.run.selection.maxObjects,
    providerCursor: page.next,
  };
}

/**
 * fetches outside the writer transaction and retains failed receipts
 * @param context clock, checkpoint, adapter and deadline
 * @returns one bounded in-memory batch
 */
export async function fetchImportBatch(
  context: FetchContext,
): Promise<ImportBatch> {
  let checkpoint: ImportCheckpoint;
  try {
    checkpoint = await listPage(context);
  } catch (error) {
    const provider = providerError(error);

    return {
      ...stopped(context.lease.checkpoint, provider.code),
      stop: !provider.retryable,
      retryAfter: provider.retryable
        ? retryTime(context.params, provider, 1)
        : null,
    };
  }
  if (!checkpoint.listed) {
    return {
      checkpoint,
      objects: [],
      reason: null,
      retryAfter: null,
      stop: false,
    };
  }
  const retrying = checkpoint.offset >= checkpoint.manifest.length;
  const candidates = batchCandidates(context, checkpoint);
  const progress: BatchProgress = {
    objects: [],
    bytes: 0,
    offset: checkpoint.offset,
    reason: null,
    retryAfter: null,
    stop: false,
  };
  for (const objectId of candidates) {
    const advance = await fetchObject(context, objectId, progress);
    if (advance && !retrying) {
      progress.offset += 1;
    }
    if (!advance || progress.reason === 'RATE_LIMITED') {
      break;
    }
  }

  return {
    checkpoint: { ...checkpoint, offset: progress.offset },
    objects: progress.objects,
    reason: progress.reason,
    retryAfter: progress.retryAfter,
    stop: progress.stop,
  };
}

/**
 * fetches one object while enforcing identity and both byte limits
 * @param context reviewed adapter and run bounds
 * @param objectId approved provider identity
 * @param progress current batch accounting
 * @returns whether the manifest position was consumed
 */
async function fetchObject(
  context: FetchContext,
  objectId: string,
  progress: BatchProgress,
): Promise<boolean> {
  try {
    const fetched = await context.adapter.fetch({
      object: { objectId },
      signal: context.signal,
    });
    if (fetched.kind !== 'snapshot') {
      progress.objects.push({ kind: fetched.kind, objectId });

      return true;
    }
    const object = mapSnapshot(context, objectId, fetched.value);
    if (
      context.lease.run.counts.bytes + progress.bytes + object.bytes >
      context.lease.run.selection.maxBytes
    ) {
      progress.reason = 'BYTE_BUDGET_EXCEEDED';
      progress.stop = true;

      return false;
    }
    if (progress.bytes + object.bytes > maximumBatchBytes) {
      return false;
    }
    progress.bytes += object.bytes;
    progress.objects.push(object);
  } catch (error) {
    recordFailure({ ...context, objectId }, progress, error);
  }

  return true;
}

/**
 * validates captured payload and the pure adapter mapping in memory
 * @param context reviewed provider and run
 * @param objectId selected identity
 * @param value untrusted adapter snapshot
 * @returns validated receipt with its measured bytes
 */
function mapSnapshot(
  context: FetchContext,
  objectId: string,
  value: unknown,
): Extract<ImportObjectResult, { kind: 'snapshot' }> {
  const snapshot = providerSnapshotSchema.parse(value);
  const mapped = mappedObjectSchema.parse(context.adapter.map(snapshot));
  const bytes = new TextEncoder().encode(
    JSON.stringify({ snapshot, mapped }),
  ).byteLength;
  if (
    snapshot.provider !== context.lease.run.provider ||
    snapshot.objectId !== objectId ||
    mapped.externalObject.provider !== snapshot.provider ||
    mapped.externalObject.objectId !== objectId
  ) {
    throw new KnowledgeProviderError({
      code: 'OBJECT_IDENTITY_MISMATCH',
      retryable: false,
    });
  }
  if (
    new TextEncoder().encode(JSON.stringify(snapshot.payload)).byteLength >
      maximumObjectBytes ||
    bytes > maximumBatchBytes
  ) {
    throw new KnowledgeProviderError({
      code: 'OBJECT_TOO_LARGE',
      retryable: false,
    });
  }

  return { kind: 'snapshot', objectId, snapshot, mapped, bytes };
}

/**
 * retains failures and the latest minimum upstream retry instant
 * @param context clock, retry history and jitter
 * @param progress accumulated batch receipts
 * @param error bounded provider or validation failure
 */
function recordFailure(
  context: FetchContext & { readonly objectId: string },
  progress: BatchProgress,
  error: unknown,
): void {
  const { objectId } = context;
  const provider = providerError(error);
  const attempt =
    (context.lease.attempts.find((item) => item.objectId === objectId)
      ?.attemptCount ?? 0) + 1;
  progress.objects.push({
    kind: 'failed',
    objectId,
    errorCode: provider.code,
    retryable: provider.retryable,
  });
  if (provider.retryable && attempt < maximumAttempts) {
    const next = retryTime(context.params, provider, attempt);
    if (!progress.retryAfter || next > progress.retryAfter) {
      progress.retryAfter = next;
    }
  }
  if (provider.code === 'RATE_LIMITED') {
    progress.reason = 'RATE_LIMITED';
  }
}

/**
 * selects the next manifest slice or bounded retry list
 * @param context current failed-object attempts
 * @param checkpoint frozen manifest and position
 * @returns at most one batch of approved identities
 */
function batchCandidates(
  context: FetchContext,
  checkpoint: ImportCheckpoint,
): readonly string[] {
  return checkpoint.offset >= checkpoint.manifest.length
    ? context.lease.attempts
        .filter(
          (item) =>
            item.attemptCount < maximumAttempts &&
            !item.errorCode?.startsWith('PERMANENT:'),
        )
        .map((item) => item.objectId)
        .slice(0, batchSize)
    : checkpoint.manifest.slice(
        checkpoint.offset,
        checkpoint.offset + batchSize,
      );
}
