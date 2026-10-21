import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

import { z } from 'zod';

import {
  jobEnvelopeSchema,
  recordDetailSchema,
  recordMessagePostedSchema,
} from '@antica/contracts';

import { createEditDraftRepository } from '../repositories/edit-drafts.js';
import { createRecordMessageRepository } from '../repositories/record-messages.js';
import { createJobRepository } from '../repositories/runtime.js';

import { resolveSavedClaim, vocabularyEntryId } from './knowledge.js';
import {
  readRecord,
  seedInvocation,
  shiftInstant,
  transactionTimeoutMs,
} from './provenance.js';
import { deleteCascade } from './reset.js';

import type {
  EditDraftResult,
  KnowledgeAttachment,
  RecordDetail,
  RecordMessagePosted,
} from '@antica/contracts';

import type { Transaction } from '../transaction.js';

import type { DemoApi } from './api.js';
import type { DemoConversation } from './fixtures/conversation.js';
import type { DemoRunContext } from './provenance.js';

/** a conversation to post on a record */
export interface DemoConversationParams {
  readonly context: DemoRunContext;
  readonly api: DemoApi;
  readonly conversation: DemoConversation;
  readonly recordId: string;
}

/** identities written for the conversation */
export interface DemoConversationResult {
  readonly editDraftId: string;
  readonly jobId: string;
  readonly messageIds: readonly string[];
}

const maximumAttempts = 3;
const replyDelayMs = 20_000;
const settlePollMs = 1000;
const settleTimeoutMs = 120_000;

/**
 * posts the collector message through the API, which freezes the cited knowledge, then completes its edit draft
 * with the designed reply instead of the development model; if the jobs drain dispatches the draft first, the
 * draft is removed and posted again
 * @param params owner context, API session, the conversation and its record
 * @returns the edit draft, its job and the two message ids
 */
export async function postConversation(
  params: DemoConversationParams,
): Promise<DemoConversationResult> {
  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    const posted = await postMessage(params);
    const replyId = await completeDraft(params, posted);
    if (replyId) {
      return {
        editDraftId: posted.editDraftId,
        jobId: posted.jobId,
        messageIds: [posted.message.id, replyId],
      };
    }
    await discardDraft(params, posted);
  }
  throw new Error(
    `The jobs drain dispatched the conversation draft ${maximumAttempts} times; rerun the seed`,
  );
}

/**
 * posts the collector message with the reply's corpus claims attached
 * @param params API session, the conversation and its record
 * @returns the posted message and the queued edit draft
 */
async function postMessage(
  params: DemoConversationParams,
): Promise<RecordMessagePosted> {
  const { api, conversation, recordId, context } = params;
  const record = await api.request(
    `/v1/records/${recordId}`,
    recordDetailSchema,
  );

  return api.request(
    `/v1/records/${recordId}/messages`,
    recordMessagePostedSchema,
    {
      method: 'POST',
      body: {
        requestKey: randomUUID(),
        body: conversation.collectorMessage,
        transcriptionIds: [],
        expectedRecordRevision: record.recordRevision,
        knowledgeAttachments: conversation.reply.flatMap((segment) =>
          segment.evidence.map((reference) => attachmentOf(context, reference)),
        ),
      },
    },
  );
}

/**
 * takes the draft's job before the drain does, saves the designed result and reply, and dates the conversation
 * @param params owner context and the conversation
 * @param posted the posted message and its queued draft
 * @returns the reply id, or null when the drain dispatched the job first
 */
async function completeDraft(
  params: DemoConversationParams,
  posted: RecordMessagePosted,
): Promise<string | null> {
  const { context, conversation } = params;
  const postedAt = new Date(conversation.createdAt).toISOString();
  const repliedAt = shiftInstant(postedAt, replyDelayMs);

  return context.db.$transaction(
    async (tx) => {
      if (!(await takeJob(tx, context.ownerId, posted.jobId))) {
        return null;
      }
      const editDrafts = createEditDraftRepository(tx, context.ownerId);
      const draft = await editDrafts.get(posted.editDraftId);
      const record = await readRecord(tx, context.ownerId, params.recordId);
      if (
        !draft ||
        !(await editDrafts.saveResult(
          posted.editDraftId,
          draftResult(params, record, posted.editDraftId),
          seedInvocation('recordEditing'),
          draft.detail.revision,
          repliedAt,
        ))
      ) {
        throw new Error('The conversation edit draft could not be saved');
      }
      await settleJob(tx, context.ownerId, { posted, repliedAt });
      const replyId = randomUUID();
      await createRecordMessageRepository(
        tx,
        context.ownerId,
      ).insertAssistantReply({
        id: replyId,
        recordId: params.recordId,
        editDraftId: posted.editDraftId,
        body: replyText(params.conversation),
        createdAt: repliedAt,
      });
      await tx.$executeRaw`update record_messages set created_at = ${postedAt}::timestamptz where id = ${posted.message.id}::uuid`;
      await tx.$executeRaw`update edit_draft_runs set created_at = ${postedAt}::timestamptz where id = ${posted.editDraftId}::uuid`;

      return replyId;
    },
    { timeout: transactionTimeoutMs },
  );
}

/**
 * claims the job's outbox delivery and dispatch step, the same rows the drain claims
 * @param tx transaction of the completion
 * @param ownerId demo owner
 * @param jobId edit draft job
 * @returns whether the seed holds the job
 */
async function takeJob(
  tx: Transaction,
  ownerId: string,
  jobId: string,
): Promise<boolean> {
  const delivered = await tx.$executeRaw`update outbox set delivered_at = now()
    where job_id = ${jobId}::uuid and owner_id = ${ownerId} and delivered_at is null
      and (lease_until is null or lease_until < now())`;
  if (delivered !== 1) {
    return false;
  }

  return createJobRepository(tx, ownerId).updateStep(
    {
      jobId,
      step: 'dispatch',
      revision: 1,
      state: 'completed',
      leaseUntil: null,
      checkpoint: null,
      result: null,
    },
    0,
  );
}

/**
 * marks the draft's job succeeded at the reply time
 * @param tx transaction of the completion
 * @param ownerId demo owner
 * @param completion the posted draft and when the reply was sent
 * @param completion.posted the posted message and its draft
 * @param completion.repliedAt reply time
 */
async function settleJob(
  tx: Transaction,
  ownerId: string,
  completion: {
    readonly posted: RecordMessagePosted;
    readonly repliedAt: string;
  },
): Promise<void> {
  const { posted, repliedAt } = completion;
  const jobs = createJobRepository(tx, ownerId);
  const job = await jobs.get(posted.jobId);
  if (
    !job ||
    !(await jobs.update(
      {
        ...job,
        state: { kind: 'succeeded', completedAt: repliedAt },
        updatedAt: repliedAt,
        result: { editDraftId: posted.editDraftId },
      },
      job.updatedAt,
    ))
  ) {
    throw new Error('The conversation job could not be settled');
  }
  await tx.$executeRaw`update jobs set created_at = ${shiftInstant(repliedAt, -replyDelayMs)}::timestamptz where id = ${posted.jobId}::uuid`;
}

/**
 * waits for the drain to finish a job it took, then deletes the draft, its messages and its job
 * @param params owner context and API session
 * @param posted the posted message and its draft
 */
async function discardDraft(
  params: DemoConversationParams,
  posted: RecordMessagePosted,
): Promise<void> {
  const deadline = Date.now() + settleTimeoutMs;
  const jobSchema = jobEnvelopeSchema(z.unknown());
  for (;;) {
    const job = await params.api.request(`/v1/jobs/${posted.jobId}`, jobSchema);
    if (['succeeded', 'partial', 'failed'].includes(job.state.kind)) {
      break;
    }
    if (Date.now() > deadline) {
      throw new Error(`Edit draft job ${posted.jobId} did not settle`);
    }
    await delay(settlePollMs);
  }
  await params.context.db.$transaction(
    async (tx) => {
      await deleteCascade(tx, params.context.ownerId, {
        table: 'edit_draft_runs',
        condition: `owner_id = $1 and id = '${posted.editDraftId}'`,
      });
      await deleteCascade(tx, params.context.ownerId, {
        table: 'jobs',
        condition: `owner_id = $1 and id = '${posted.jobId}'`,
      });
    },
    { timeout: transactionTimeoutMs },
  );
}

/**
 * builds the ready draft result: the cited reply and the designed field proposals
 * @param params owner context and the conversation
 * @param record record as it stands when the reply is sent
 * @param editDraftId draft the result belongs to
 * @returns edit draft result
 */
function draftResult(
  params: DemoConversationParams,
  record: RecordDetail,
  editDraftId: string,
): EditDraftResult {
  const { context, conversation } = params;

  return {
    editDraftId,
    recordId: record.id,
    baseVersions: {
      recordRevision: record.recordRevision,
      analysisInputVersion: record.analysisInputVersion,
      evidenceVersion: record.evidenceVersion,
    },
    sourceTranscriptionIds: [],
    sourceObservationIds: [],
    replyZhHant: replyText(conversation),
    answerSegments: conversation.reply.map((segment) => ({
      text: segment.text,
      evidenceRefs: segment.evidence.map((reference) =>
        attachmentOf(context, reference),
      ),
    })),
    suggestedDescriptionZhHant: record.description,
    proposedChanges: conversation.proposals.map((proposal) =>
      proposal.field === 'name'
        ? {
            id: randomUUID(),
            findingIds: [],
            field: 'name',
            before: record.name,
            proposed: proposal.proposed,
          }
        : {
            id: randomUUID(),
            findingIds: [],
            field: 'materialIds',
            before: record.materialIds,
            proposed: proposal.proposedTerms.map((term) =>
              vocabularyEntryId(context.vocabulary, term),
            ),
          },
    ),
  };
}

/**
 * joins the reply segments the way the edit handler does
 * @param conversation the designed reply
 * @returns reply body
 */
function replyText(conversation: DemoConversation): string {
  return conversation.reply.map((segment) => segment.text).join('\n');
}

/**
 * resolves a corpus claim reference into an evidence attachment
 * @param context saved corpus
 * @param reference `<content id>#<claim key>`
 * @returns attachment identity accepted by the message API
 */
function attachmentOf(
  context: DemoRunContext,
  reference: string,
): KnowledgeAttachment {
  const claim = resolveSavedClaim(context.corpus, reference);

  return {
    entryId: claim.entryId,
    revision: claim.revision,
    claimKey: claim.claimKey,
    citationIds: [...claim.citationIds],
  };
}
