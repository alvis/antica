import { jsonValue } from '../json.js';

import { installEntry } from './corpus-entries.js';
import { inspectInstall } from './corpus-plan.js';
import { installCorpusSource } from './corpus-sources.js';
import { installCorpusTaxonomy } from './corpus-taxonomy.js';

import type { CorpusInstallRepository } from '@antica/application/ports';

import type { Database } from '../connection.js';
import type { Transaction } from '../transaction.js';

import type { PreparedInstall } from './corpus-plan.js';

/** optional failure injection runs inside the batch transaction before checkpointing */
export interface CorpusInstallOptions {
  readonly beforeCheckpoint?: (index: number) => Promise<void>;
  readonly onBatch?: (index: number, phase: 'start' | 'complete') => void;
}
/**
 * exposes owner-scoped inspection and serialized checkpointed corpus transactions
 * @param db PostgreSQL persistence capability
 * @param options optional transaction failure injection for crash recovery tests
 * @returns application installation port
 */
export function createCorpusInstallRepository(
  db: Database,
  options: CorpusInstallOptions = {},
): CorpusInstallRepository {
  let prepared: PreparedInstall | undefined;

  return {
    inspect: async (request) => {
      prepared = await inspectInstall(db, request);

      return prepared.plan;
    },
    applyBatch: async (index) => {
      if (!prepared) {
        throw new Error(
          'Inspect the corpus installation before writing batches',
        );
      }
      const input = prepared;
      options.onBatch?.(index, 'start');
      await db.$transaction(async (tx) => {
        const lockKey = `${input.request.ownerId}:${input.request.release.corpusId}`;
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))::text`;
        await applyBatch(tx, input, { index, options });
      });
      options.onBatch?.(index, 'complete');
    },
  };
}

/**
 * creates immutable global release metadata and a resumable owner receipt
 * @param tx batch transaction holding the owner/corpus lock
 * @param input prepared owner release
 */
async function startInstall(
  tx: Transaction,
  input: PreparedInstall,
): Promise<void> {
  const { request, releaseId, plan } = input;
  const { release, ownerId, requestKey } = request;
  await tx.corpusRelease.createMany({
    data: {
      id: releaseId,
      corpusId: release.corpusId,
      version: release.version,
      schemaVersion: release.formatVersion,
      manifestHash: release.manifestHash,
      publishedAt: release.publishedAt,
      editorialReviewer: release.reviewer,
      status: release.publishedAt ? 'published' : 'draft',
      rightsNotices: jsonValue(release.rightsNotices),
    },
    skipDuplicates: true,
  });
  const stored = await tx.corpusRelease.findUniqueOrThrow({
    where: { id: releaseId },
  });
  if (stored.manifestHash !== release.manifestHash) {
    throw new Error('Published corpus version has different manifest bytes');
  }
  await tx.corpusInstall.createMany({
    data: {
      id: plan.installId,
      ownerId,
      releaseId,
      requestKey,
      status: 'running',
      counts: { checkpoint: 0 },
    },
    skipDuplicates: true,
  });
}

/**
 * commits exactly one snapshot, taxonomy group or entry with its progress checkpoint
 * @param tx atomic batch transaction
 * @param input prepared owner release
 * @param batch expected checkpoint and failure injection capability
 * @param batch.index expected checkpoint
 * @param batch.options failure injection capability
 */
async function applyBatch(
  tx: Transaction,
  input: PreparedInstall,
  batch: { readonly index: number; readonly options: CorpusInstallOptions },
): Promise<void> {
  const { index, options } = batch;
  const { request, plan, content } = input;
  if (index === 0) {
    await startInstall(tx, input);
  }
  const receipt = await tx.corpusInstall.findFirstOrThrow({
    where: {
      id: plan.installId,
      ownerId: request.ownerId,
      requestKey: request.requestKey,
    },
  });
  const checkpoint = Number(
    (receipt.counts as { checkpoint: number }).checkpoint,
  );
  if (receipt.status === 'completed' || checkpoint > index) {
    return;
  }
  if (checkpoint !== index) {
    throw new Error('Corpus checkpoint is stale');
  }
  let action: Awaited<ReturnType<typeof installEntry>> | undefined;
  if (index < request.sources.length) {
    await installCorpusSource(
      { tx, ownerId: request.ownerId, content },
      request.sources[index]!,
    );
  } else if (index === request.sources.length) {
    await installCorpusTaxonomy(tx, request, content);
  } else {
    action = await installEntry(tx, input, index - request.sources.length - 1);
  }
  await options.beforeCheckpoint?.(index);
  const completed = index + 1 === plan.batchCount;
  await tx.corpusInstall.update({
    where: { id: plan.installId },
    data: {
      counts: {
        ...(receipt.counts as Record<string, number>),
        checkpoint: index + 1,
        ...(action
          ? {
              [action]:
                ((receipt.counts as Record<string, number>)[action] ?? 0) + 1,
            }
          : {}),
      },
      status: completed ? 'completed' : 'running',
      installedAt: completed ? new Date() : null,
    },
  });
}
