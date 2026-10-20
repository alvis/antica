import {
  knowledgeEntryDetailV2Schema,
  knowledgeReadV2Schema,
} from '@antica/contracts';

import { KnowledgeReferenceError, validateReferences } from './references.js';
import { appendRevision } from './write-v2.js';

import type {
  KnowledgeContentEnvelopeV2,
  KnowledgeEntryDetailV2,
  KnowledgeReadV2,
} from '@antica/contracts';

import type {
  knowledgeEntries,
  knowledgeRevisions,
} from '../../generated/client.js';
import type { Transaction } from '../../transaction.js';

import type { RevisionWrite } from './write-v2.js';

/** transaction and owner shared by every v2 operation */
export interface KnowledgeContext {
  readonly tx: Transaction;
  readonly ownerId: string;
}

/** append-only v2 revision capabilities over a caller-owned transaction */
export interface KnowledgeV2Repository {
  getV2(
    id: string,
    input?: KnowledgeReadV2,
  ): Promise<KnowledgeEntryDetailV2 | null>;
  getV2Hash(id: string, input?: KnowledgeReadV2): Promise<string | null>;
  validateV2References(content: KnowledgeContentEnvelopeV2): Promise<boolean>;
  createV2(
    write: RevisionWrite & { readonly displayCode: string },
  ): Promise<KnowledgeEntryDetailV2>;
  addRevisionV2(
    write: RevisionWrite & { readonly expectedRevision: number },
  ): Promise<KnowledgeEntryDetailV2 | null>;
}

/**
 * selects an exact owner-scoped revision without substituting a newer head
 * @param context transaction and required owner
 * @param id aggregate identity
 * @param input requested read view; omission selects working head
 * @returns base and pinned revision rows, or null when unavailable
 */
async function readRevision(
  context: KnowledgeContext,
  id: string,
  input: KnowledgeReadV2 = {},
): Promise<{ base: knowledgeEntries; row: knowledgeRevisions } | null> {
  const read = knowledgeReadV2Schema.parse(input);
  const base = await context.tx.knowledgeEntries.findFirst({
    where: { id, ownerId: context.ownerId },
  });
  if (!base) {
    return null;
  }
  const revision =
    read.view === 'saved'
      ? base.latestSavedRevision
      : read.view === 'revision'
        ? read.revision
        : base.currentRevision;
  if (revision === null) {
    return null;
  }
  const row = await context.tx.knowledgeRevisions.findFirst({
    where: { entryId: id, revision },
  });

  return row ? { base, row } : null;
}

/**
 * reconstructs v2 detail solely from its immutable envelope
 * @param context transaction and required owner
 * @param id aggregate identity
 * @param input requested read view
 * @returns v2 detail or null for absent and legacy revisions
 */
async function getDetail(
  context: KnowledgeContext,
  id: string,
  input?: KnowledgeReadV2,
): Promise<KnowledgeEntryDetailV2 | null> {
  const selected = await readRevision(context, id, input);
  if (selected?.row.contentSchemaVersion !== 2) {
    return null;
  }
  const { base, row } = selected;

  return knowledgeEntryDetailV2Schema.parse({
    id,
    displayCode: base.displayCode,
    revision: row.revision,
    status: row.status,
    savedBy: row.savedBy,
    contentHash: row.contentHash,
    createdAt: base.createdAt.toISOString(),
    updatedAt: row.createdAt.toISOString(),
    content: row.content,
  });
}

/**
 * checks references while preserving database failures for the caller
 * @param context transaction and required owner
 * @param content validated immutable envelope
 * @returns false only for inaccessible or inconsistent evidence
 */
async function referencesAccessible(
  context: KnowledgeContext,
  content: KnowledgeContentEnvelopeV2,
): Promise<boolean> {
  try {
    await validateReferences(context, content);

    return true;
  } catch (error) {
    if (error instanceof KnowledgeReferenceError) {
      return false;
    }
    throw error;
  }
}

/**
 * advances the saved pointer only after an explicit saved revision was appended
 * @param context transaction and required owner
 * @param write server-authorized content and action
 * @param revision exact newly appended revision
 */
async function advanceSaved(
  context: KnowledgeContext,
  write: RevisionWrite,
  revision: number,
): Promise<void> {
  if (write.status === 'saved') {
    await context.tx.knowledgeEntries.updateMany({
      where: { id: write.entryId, ownerId: context.ownerId },
      data: { latestSavedRevision: revision },
    });
  }
}

/**
 * creates the first immutable revision and working head
 * @param context transaction and required owner
 * @param write server-authorized initial content and display code
 * @returns initial v2 detail
 */
async function create(
  context: KnowledgeContext,
  write: RevisionWrite & { readonly displayCode: string },
): Promise<KnowledgeEntryDetailV2> {
  await context.tx.knowledgeEntries.create({
    data: {
      id: write.entryId,
      ownerId: context.ownerId,
      displayCode: write.displayCode,
      currentRevision: 1,
    },
  });
  await appendRevision(context, { ...write, revision: 1 });
  await advanceSaved(context, write, 1);

  return (await getDetail(context, write.entryId))!;
}

/**
 * appends content only if the owner working head still matches the expected revision
 * @param context transaction and required owner
 * @param write server-authorized content with optimistic concurrency token
 * @returns new detail or null for a stale or inaccessible working head
 */
async function append(
  context: KnowledgeContext,
  write: RevisionWrite & { readonly expectedRevision: number },
): Promise<KnowledgeEntryDetailV2 | null> {
  const revision = write.expectedRevision + 1;
  const changed = await context.tx.knowledgeEntries.updateMany({
    where: {
      id: write.entryId,
      ownerId: context.ownerId,
      currentRevision: write.expectedRevision,
    },
    data: { currentRevision: revision, updatedAt: new Date() },
  });
  if (!changed.count) {
    return null;
  }
  await appendRevision(context, { ...write, revision });
  await advanceSaved(context, write, revision);

  return getDetail(context, write.entryId);
}

/**
 * exposes append-only v2 operations bound to the caller's existing transaction
 * @param tx transaction shared with command receipts and source validation
 * @param ownerId owner whose revisions are accessible
 * @returns v2 read and append capabilities
 */
export function createKnowledgeV2Repository(
  tx: Transaction,
  ownerId: string,
): KnowledgeV2Repository {
  const context = { tx, ownerId };

  return {
    /**
     * reads a v2 envelope at the selected view
     * @param id knowledge identity
     * @param input selected view and revision
     * @returns pinned v2 detail
     */
    getV2: async (id, input) => getDetail(context, id, input),
    /**
     * reads the persisted hash for legacy and v2 revisions
     * @param id knowledge identity
     * @param input selected view and revision
     * @returns persisted content hash or null
     */
    getV2Hash: async (id, input) =>
      (await readRevision(context, id, input))?.row.contentHash ?? null,
    /**
     * checks every pinned reference in the current transaction
     * @param content validated envelope
     * @returns whether all references remain accessible
     */
    validateV2References: async (content) =>
      referencesAccessible(context, content),
    /**
     * appends the first immutable revision
     * @param write initial content and explicit action
     * @returns newly created detail
     */
    createV2: async (write) => create(context, write),
    /**
     * appends a revision under optimistic concurrency
     * @param write next content and expected head
     * @returns new detail or null on conflict
     */
    addRevisionV2: async (write) => append(context, write),
  };
}
