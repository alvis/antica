import { createHash } from 'node:crypto';

import {
  RecordMessageCursorError,
  RecordMessageReplayConflictError,
} from '../ports/index.js';
import { submitEditDraft } from '../voice/edit.js';

import type {
  ModelSelection,
  RecordMessage,
  RecordMessageEntry,
  RecordMessageListQuery,
  RecordMessagePage,
  RecordMessagePost,
  RecordMessagePosted,
} from '@antica/contracts';

import type {
  ClockPort,
  IdPort,
  ListedRecordMessage,
  OperationResult,
  TransactionPort,
} from '../ports/index.js';

/** per-record conversation in which each collector message starts an edit draft */
export interface RecordMessageService {
  /**
   * stores a collector message and queues the edit draft that will answer it
   * @param ownerId authenticated collector
   * @param recordId record the message is about
   * @param input message text or confirmed transcriptions, the idempotency key, and the record revision the collector saw
   * @returns the stored message with its draft and job; an identical replay returns the earlier result and starts nothing
   */
  post(
    ownerId: string,
    recordId: string,
    input: RecordMessagePost,
  ): Promise<OperationResult<RecordMessagePosted>>;
  /**
   * reads one page of the conversation
   * @param ownerId authenticated collector
   * @param recordId record whose conversation is read
   * @param query cursor and page size; the first page holds the newest messages
   * @returns messages oldest first within the page, each with the state of its edit draft
   */
  list(
    ownerId: string,
    recordId: string,
    query: RecordMessageListQuery,
  ): Promise<OperationResult<RecordMessagePage>>;
}

/**
 * creates the conversation commands of a record
 * @param transaction provides owner-scoped records, drafts, messages, jobs, and receipts
 * @param selection identifies the model that answers each message
 * @param clock timestamps messages and drafts
 * @param ids creates message, job, and outbox identifiers
 * @returns service whose posts are idempotent per request key
 */
export function createRecordMessageService(
  transaction: TransactionPort,
  selection: ModelSelection,
  clock: ClockPort,
  ids: IdPort,
): RecordMessageService {
  const postInTransaction = async (
    ownerId: string,
    recordId: string,
    input: RecordMessagePost,
  ): Promise<OperationResult<RecordMessagePosted>> =>
    transaction.run<OperationResult<RecordMessagePosted>>(
      ownerId,
      async (unit) => {
        const fingerprint = digest({
          recordId,
          body: input.body,
          transcriptionIds: input.transcriptionIds,
          expectedRecordRevision: input.expectedRecordRevision,
        });
        const prior = await unit.commands.get(
          ownerId,
          'recordMessages.post',
          input.requestKey,
        );
        if (prior) {
          return prior.fingerprint === fingerprint
            ? { success: true, data: prior.result as RecordMessagePosted }
            : failure('VALIDATION_FAILED', REUSED_KEY_MESSAGE);
        }
        // a key already spent by POST /v1/edit-drafts would replay that draft, which has no collector message
        if (
          await unit.commands.get(
            ownerId,
            'editDrafts.submit',
            input.requestKey,
          )
        ) {
          return failure('VALIDATION_FAILED', REUSED_KEY_MESSAGE);
        }
        const accepted = await submitEditDraft(
          unit,
          ownerId,
          {
            requestKey: input.requestKey,
            recordId,
            expectedRecordRevision: input.expectedRecordRevision,
            transcriptionIds: input.transcriptionIds,
            observationIds: [],
            instructionZhHant: input.body,
          },
          { selection, clock, ids, allowInstructionOnly: true },
        );
        if (!accepted.success) {
          return accepted;
        }
        const draft = await unit.editDrafts.get(accepted.data.editDraftId);
        if (!draft) {
          return failure('NOT_FOUND', 'Edit draft not found');
        }
        const body =
          input.body ||
          draft.detail.snapshot.sourceText
            .filter((source) => source.kind === 'transcription')
            .map((source) => source.text.trim())
            .filter((text) => text !== '')
            .join('\n');
        if (body === '') {
          return failure(
            'VALIDATION_FAILED',
            'The message has no text to send',
          );
        }
        let message: RecordMessage;
        try {
          ({ message } = await unit.recordMessages.insertCollectorMessage({
            id: ids.create(),
            recordId,
            requestKey: input.requestKey,
            body,
            editDraftId: accepted.data.editDraftId,
            createdAt: clock.now(),
          }));
        } catch (error) {
          if (error instanceof RecordMessageReplayConflictError) {
            return failure('VALIDATION_FAILED', REUSED_KEY_MESSAGE);
          }
          throw error;
        }
        const posted: RecordMessagePosted = {
          ...accepted.data,
          message: { ...message, author: 'collector' },
        };
        await unit.commands.insert({
          ownerId,
          operation: 'recordMessages.post',
          requestKey: input.requestKey,
          fingerprint,
          status: 202,
          result: posted,
        });

        return { success: true, data: posted };
      },
    );

  return {
    post: async (ownerId, recordId, input) => {
      try {
        return await postInTransaction(ownerId, recordId, input);
      } catch (error) {
        // the losing side of two posts racing on one key: the winner's receipt answers the retry
        if (isUniqueViolation(error)) {
          return {
            success: false,
            error: {
              code: 'REVISION_CONFLICT',
              message: 'Another request with this key is in progress',
              retryable: true,
            },
          };
        }
        throw error;
      }
    },
    list: async (ownerId, recordId, query) =>
      transaction.run<OperationResult<RecordMessagePage>>(
        ownerId,
        async (unit) => {
          if (!(await unit.records.get(recordId))) {
            return failure('NOT_FOUND', 'Record not found');
          }
          try {
            const page = await unit.recordMessages.listByRecord({
              recordId,
              cursor: query.cursor,
              limit: query.limit,
            });

            return {
              success: true,
              data: {
                items: page.items.map(toEntry),
                nextCursor: page.nextCursor,
              },
            };
          } catch (error) {
            if (error instanceof RecordMessageCursorError) {
              return failure('VALIDATION_FAILED', 'Cursor is invalid');
            }
            throw error;
          }
        },
      ),
  };
}

const REUSED_KEY_MESSAGE = 'Idempotency key was used for a different request';

/** Postgres error code of a unique-constraint violation */
const UNIQUE_VIOLATION = '23505';

/**
 * recognizes a unique-constraint violation, which the driver reports on the error or on its cause
 * @param error value thrown out of a transaction
 * @returns true when a unique constraint rejected a write
 */
function isUniqueViolation(error: unknown): boolean {
  const { code, cause } = Object(error) as {
    code?: unknown;
    cause?: { code?: unknown } | null;
  };

  return code === UNIQUE_VIOLATION || cause?.code === UNIQUE_VIOLATION;
}

/**
 * combines a stored message with its draft, reporting a draft whose job failed as failed
 * @param listed stored message with the facts of its edit draft
 * @param listed.message stored message
 * @param listed.draft facts of the edit draft behind the message
 * @returns entry the app renders as thinking, an edit card, or a failure
 */
function toEntry({ message, draft }: ListedRecordMessage): RecordMessageEntry {
  return {
    ...message,
    draft: {
      status:
        draft.status === 'pending' && draft.jobFailed ? 'failed' : draft.status,
      revision: draft.revision,
      proposedChanges: [...draft.proposedChanges],
      appliedProposalIds: [...draft.appliedProposalIds],
    },
  };
}

/**
 * fingerprints a request so a replay can be compared with the stored one
 * @param value request fields in a fixed order
 * @returns hex SHA-256 of the JSON form
 */
function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

/**
 * builds an expected failure that the caller cannot retry
 * @param code public error code
 * @param message explanation shown to the caller
 * @returns failed result whose transaction rolls back
 */
function failure(
  code: 'NOT_FOUND' | 'VALIDATION_FAILED',
  message: string,
): OperationResult<never> {
  return { success: false, error: { code, message, retryable: false } };
}
