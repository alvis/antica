import { randomUUID } from 'node:crypto';

import { jsonValue } from '../json.js';

import { corpusId } from './corpus-identity.js';
import { disposition } from './corpus-plan.js';
import { preloadCorpusReferences } from './corpus-references.js';
import { canonicalHash } from './knowledge/canonical.js';
import { createKnowledgeV2Repository } from './knowledge/v2.js';

import type { CorpusInstallDisposition } from '@antica/application/ports';
import type { KnowledgeContentEnvelopeV2 } from '@antica/contracts';

import type {
  CorpusInstallItem,
  knowledgeEntries,
} from '../generated/client.js';
import type { Transaction } from '../transaction.js';

import type { PreparedInstall } from './corpus-plan.js';

interface EntryContext {
  readonly ownerId: string;
  readonly entryId: string;
  readonly contentId: string;
  readonly envelope: KnowledgeContentEnvelopeV2;
  readonly hash: string;
  readonly action: CorpusInstallDisposition['disposition'];
  readonly head: knowledgeEntries | null;
  readonly previous?: CorpusInstallItem;
}
/**
 * appends an unsaved v2 revision or records a conflict without touching collector content
 * @param tx batch transaction
 * @param input prepared corpus and prior receipt bases
 * @param index entry position in the validated release
 * @returns committed disposition for receipt counts
 */
export async function installEntry(
  tx: Transaction,
  input: PreparedInstall,
  index: number,
): Promise<CorpusInstallDisposition['disposition']> {
  const { request, content, plan, prior } = input;
  const { ownerId } = request;
  const entry = request.entries[index]!;
  const envelope = content.entry(entry);
  const hash = canonicalHash(envelope);
  const entryId = corpusId(ownerId, entry.id);
  await tx.$queryRaw`SELECT id FROM knowledge_entries WHERE owner_id = ${ownerId} AND id = ${entryId}::uuid FOR UPDATE`;
  const head = await tx.knowledgeEntries.findFirst({
    where: { ownerId, id: entryId },
  });
  const previous = prior.get(entry.id);
  const action = disposition(head, previous, hash);
  const context = {
    ownerId,
    entryId,
    contentId: entry.id,
    envelope,
    hash,
    head,
    previous,
    action,
  };
  let revision = previous?.revision ?? head?.currentRevision ?? 1;
  if (action === 'created' || action === 'update_draft') {
    revision = await appendDraft(tx, context);
  }
  if (action === 'conflict' || action === 'update_draft') {
    await writeDiff(tx, context, { revision, releaseId: input.releaseId });
  }
  const pinned =
    action === 'conflict'
      ? await tx.knowledgeRevisions.findUniqueOrThrow({
          where: { entryId_revision: { entryId, revision } },
        })
      : null;
  await tx.corpusInstallItem.create({
    data: {
      installId: plan.installId,
      contentId: entry.id,
      entryId,
      revision,
      contentHash: pinned?.contentHash ?? hash,
      disposition: action,
    },
  });

  return action;
}
/**
 * routes all revision and projection writes through KDB06 without invoking Save
 * @param tx batch transaction
 * @param context pinned entry and current collector base
 * @returns newly appended draft revision
 */
async function appendDraft(
  tx: Transaction,
  context: EntryContext,
): Promise<number> {
  const { ownerId, entryId, envelope, action, head, contentId } = context;
  const references = await preloadCorpusReferences(tx, ownerId, envelope);
  const repository = createKnowledgeV2Repository(references, ownerId);
  const write = {
    entryId,
    content: envelope,
    status: 'draft' as const,
    savedBy: null,
    reviewedBy: envelope.editorialReview.actor ?? null,
    reviewedAt: envelope.editorialReview.at
      ? new Date(envelope.editorialReview.at)
      : null,
  };
  const result =
    action === 'created'
      ? await repository.createV2({
          ...write,
          displayCode: `CORPUS-${entryId}`,
        })
      : await repository.addRevisionV2({
          ...write,
          expectedRevision: head!.currentRevision,
        });
  if (action === 'created') {
    await tx.knowledgeEntries.update({
      where: { id: entryId, ownerId },
      data: { contentId },
    });
  }

  // The locked head and validated create path guarantee a persisted revision.
  return result!.revision;
}
/**
 * records both immutable bases and the incoming proposal without editing collector content
 * @param tx batch transaction
 * @param context owner, old receipt and current collector base
 * @param candidate exact revision and release identities
 * @param candidate.revision installed candidate or prior pinned revision
 * @param candidate.releaseId proposed corpus release
 */
async function writeDiff(
  tx: Transaction,
  context: EntryContext,
  candidate: { readonly revision: number; readonly releaseId: string },
): Promise<void> {
  const { entryId, ownerId, head, previous, hash, action } = context;
  const candidateRevision =
    action === 'conflict' ? head!.currentRevision : candidate.revision;
  const existing = await tx.reviewDiff.findUnique({
    where: { entryId_candidateRevision: { entryId, candidateRevision } },
  });
  const changes = diffChanges(context, candidate.releaseId);
  const candidateContentHash =
    action === 'conflict'
      ? (
          await tx.knowledgeRevisions.findUniqueOrThrow({
            where: {
              entryId_revision: { entryId, revision: candidateRevision },
            },
          })
        ).contentHash
      : hash;
  await tx.reviewDiff.upsert({
    where: { entryId_candidateRevision: { entryId, candidateRevision } },
    create: {
      id: randomUUID(),
      ownerId,
      entryId,
      baseRevision: previous?.revision ?? head!.currentRevision,
      candidateRevision,
      baseContentHash: previous?.contentHash,
      candidateContentHash,
      changes,
      status: 'pending',
    },
    update: {
      changes: jsonValue({
        previous: existing?.changes ?? null,
        incoming: changes,
      }),
      candidateContentHash,
      status: 'pending',
    },
  });
}
/**
 * retains the incoming envelope separately from the collector head on conflict
 * @param context collector and installed bases
 * @param releaseId incoming corpus release
 * @returns immutable proposal with both bases
 */
function diffChanges(
  context: EntryContext,
  releaseId: string,
): ReturnType<typeof jsonValue> {
  const { previous, head, action, hash, envelope } = context;

  return jsonValue({
    kind: action,
    installedBase: previous
      ? { revision: previous.revision, contentHash: previous.contentHash }
      : null,
    collectorBase: {
      revision: head!.currentRevision,
      latestSavedRevision: head!.latestSavedRevision,
    },
    releaseId,
    proposedContentHash: hash,
    proposedContent: envelope,
  });
}
