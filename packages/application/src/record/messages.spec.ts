import { describe, expect, it, vi } from 'vitest';

import { recordMessagePostedSchema } from '@antica/contracts';

import {
  RecordMessageCursorError,
  RecordMessageReplayConflictError,
} from '../ports/index.js';

import { recordFieldsOf } from './fields.js';
import { createRecordMessageService } from './messages.js';

import type {
  EditDraftRequest,
  ModelSelection,
  ProposedChange,
  RecordDetail,
  RecordMessage,
  RecordMessagePost,
} from '@antica/contracts';
import type { Observation } from '@antica/domain';

import type {
  CommandReceipt,
  EditDraftRunRecord,
  ListedRecordMessage,
  OperationResult,
  TransactionPort,
  UnitOfWork,
} from '../ports/index.js';

const ownerId = '00000000-0000-4000-8000-000000000001';
const recordId = '00000000-0000-4000-8000-000000000002';
const requestKey = '00000000-0000-4000-8000-000000000003';
const firstTranscriptionId = '00000000-0000-4000-8000-000000000004';
const secondTranscriptionId = '00000000-0000-4000-8000-000000000005';
const generatedId = '00000000-0000-4000-8000-000000000006';
const now = '2026-10-16T12:00:00.000Z';
const selection = {
  role: 'recordEditing',
  modelId: 'development',
  profileVersion: '1',
} satisfies ModelSelection;
const post = {
  requestKey,
  body: 'Please tidy the description',
  transcriptionIds: [],
  expectedRecordRevision: 1,
} satisfies RecordMessagePost;

function record(): RecordDetail {
  return {
    id: recordId,
    code: 'ANT-0001',
    name: 'Vase',
    unitKind: 'single',
    components: [],
    pieceCount: null,
    categoryIds: [],
    materialIds: [],
    period: null,
    dimensions: {},
    location: { locationId: null, detail: '' },
    acquisition: { receiptAssetIds: [] },
    tags: [],
    description: '',
    collectorJudgment: null,
    recordRevision: 1,
    analysisInputVersion: 1,
    evidenceVersion: 1,
    createdAt: now,
    updatedAt: now,
    mediaIds: [],
    checkIds: [],
    latestRunId: null,
    analysisFreshness: 'unanalyzed',
  };
}

function observation(id: string, text: string): Observation {
  return {
    id,
    recordId,
    componentIds: [],
    channel: 'voice',
    text,
    evidenceAnchorIds: [],
    checkIds: [],
    observedAt: now,
    voice: null,
    editDraftId: null,
    supersedesObservationId: null,
    supersededByObservationId: null,
    author: 'collector',
    createdAt: now,
  };
}

/**
 * a confirmed transcription whose adopted text is read through an observation of the same ID
 * @param id
 */
function confirmed(id: string) {
  return {
    detail: {
      snapshot: { recordId },
      status: 'confirmed',
      confirmedObservationId: id,
      revision: 2,
    },
  };
}

interface ReadyTranscription {
  readonly status?: 'pending' | 'ready' | 'confirmed';
  readonly recordId?: string;
  readonly reading: string;
  readonly original?: string;
}

/**
 * a transcription that has not been confirmed, so no observation exists for it
 * @param id
 * @param facts
 */
function unconfirmed(id: string, facts: ReadyTranscription) {
  return {
    detail: {
      transcriptionId: id,
      snapshot: { recordId: facts.recordId ?? recordId },
      status: facts.status ?? 'ready',
      confirmedObservationId: null,
      revision: 4,
      result: {
        readingTextZhHant: facts.reading,
        originalText: facts.original ?? 'original',
      },
    },
  };
}

interface Stored {
  receipts: Map<string, CommandReceipt>;
  drafts: Map<string, EditDraftRunRecord>;
  messages: RecordMessage[];
  jobs: number;
  events: number;
}

/**
 * builds a fake transaction that restores its state when a result fails
 * @param options facts the fake repositories report
 * @param options.record
 * @param options.texts
 * @param options.unconfirmed
 * @param options.draftVanishes
 * @param options.listed
 * @param options.listFailure
 * @param options.insertFailure
 * @returns the service under test, the committed state, and the spies
 */
function fixture(
  options: {
    readonly record?: RecordDetail | null;
    readonly texts?: Readonly<Record<string, string>>;
    readonly unconfirmed?: Readonly<Record<string, ReadyTranscription>>;
    readonly draftVanishes?: boolean;
    readonly listed?: readonly ListedRecordMessage[];
    readonly listFailure?: Error;
    readonly insertFailure?: unknown;
  } = {},
) {
  const state: Stored = {
    receipts: new Map(),
    drafts: new Map(),
    messages: [],
    jobs: 0,
    events: 0,
  };
  const texts = options.texts ?? {};
  const pending = options.unconfirmed ?? {};
  const getObservation = vi.fn(async (id: string) =>
    observation(id, texts[id] ?? ''),
  );
  const insertCollectorMessage = vi.fn(
    async (input: {
      id: string;
      recordId: string;
      requestKey: string;
      body: string;
      editDraftId: string;
      createdAt: string;
    }) => {
      if (options.insertFailure) {
        // a non-error value exercises what the driver could throw
        throw options.insertFailure as Error;
      }
      const message: RecordMessage = {
        id: input.id,
        recordId: input.recordId,
        author: 'collector',
        body: input.body,
        editDraftId: input.editDraftId,
        createdAt: input.createdAt,
      };
      state.messages.push(message);

      return { message, created: true };
    },
  );
  const listByRecord = vi.fn(async () => {
    if (options.listFailure) {
      throw options.listFailure;
    }

    return { items: options.listed ?? [], nextCursor: 'older' };
  });
  const repositories = {
    knowledge: {
      related: async () => ({
        cards: [],
        recordRevision: 1,
        contextHash: 'a'.repeat(64),
        reason: 'no_match' as const,
      }),
      getV2: async () => null,
      getCorpusGeneration: async () => 'generation-1',
    },
    commands: {
      get: async (_owner: string, operation: string, key: string) =>
        state.receipts.get(`${operation}:${key}`) ?? null,
      insert: async (receipt: CommandReceipt) => {
        state.receipts.set(
          `${receipt.operation}:${receipt.requestKey}`,
          receipt,
        );
      },
    },
    records: {
      get: async () =>
        'record' in options ? (options.record ?? null) : record(),
    },
    transcriptions: {
      get: async (id: string) => {
        if (id in pending) {
          return unconfirmed(id, pending[id]!);
        }

        return id in texts ? confirmed(id) : null;
      },
    },
    evidence: {
      getObservation,
    },
    jobs: {
      create: async () => {
        state.jobs += 1;
      },
    },
    outbox: {
      enqueue: async () => {
        state.events += 1;
      },
    },
    editDrafts: {
      create: async (run: EditDraftRunRecord) => {
        state.drafts.set(run.detail.editDraftId, run);
      },
      get: async (id: string) =>
        options.draftVanishes ? null : (state.drafts.get(id) ?? null),
    },
    recordMessages: { insertCollectorMessage, listByRecord },
  };
  const unit = new Proxy({} as UnitOfWork, {
    get(_target, key) {
      if (key in repositories) {
        return Reflect.get(repositories, key);
      }
      throw new Error(`Unexpected repository: ${String(key)}`);
    },
  });
  const transaction: TransactionPort = {
    run: async <T extends OperationResult<unknown>>(
      _owner: string,
      operation: (work: UnitOfWork) => Promise<T>,
    ): Promise<T> => {
      const before = {
        receipts: new Map(state.receipts),
        drafts: new Map(state.drafts),
        messages: [...state.messages],
        jobs: state.jobs,
        events: state.events,
      };
      try {
        const result = await operation(unit);
        if (!result.success) {
          Object.assign(state, before);
        }

        return result;
      } catch (error) {
        Object.assign(state, before);
        throw error;
      }
    },
  };
  const service = createRecordMessageService(
    transaction,
    selection,
    { now: () => now },
    { create: () => generatedId },
  );

  return {
    service,
    state,
    insertCollectorMessage,
    listByRecord,
    getObservation,
  };
}

describe('fn:createRecordMessageService', () => {
  describe('post', () => {
    it('should store the message and start exactly one edit draft from its text', async () => {
      const ports = fixture();

      const result = await ports.service.post(ownerId, recordId, post);

      expect(result).toEqual({
        success: true,
        data: {
          editDraftId: requestKey,
          jobId: generatedId,
          knowledgeSnapshot: {
            snapshotId: generatedId,
            snapshotHash: expect.any(String),
          },
          message: {
            id: generatedId,
            recordId,
            author: 'collector',
            body: 'Please tidy the description',
            editDraftId: requestKey,
            createdAt: now,
          },
        },
      });
      expect(
        recordMessagePostedSchema.safeParse((result as { data: unknown }).data)
          .success,
      ).toBe(true);
      expect(ports.state.jobs).toBe(1);
      expect(ports.state.events).toBe(1);
      expect(ports.state.drafts.get(requestKey)).toMatchObject({
        request: {
          requestKey,
          recordId,
          expectedRecordRevision: 1,
          transcriptionIds: [],
          observationIds: [],
          instructionZhHant: 'Please tidy the description',
        } satisfies EditDraftRequest,
        modelSelection: selection,
      });
      expect(ports.state.drafts.get(requestKey)?.detail.snapshot).toMatchObject(
        { recordId, fields: recordFieldsOf(record()) },
      );
    });

    it('should return the stored result and start nothing when the same post is replayed', async () => {
      const ports = fixture();
      const first = await ports.service.post(ownerId, recordId, post);

      const replay = await ports.service.post(ownerId, recordId, {
        ...post,
        knowledgeAttachments: [],
      });

      expect(replay).toEqual(first);
      expect(ports.state.jobs).toBe(1);
      expect(ports.state.events).toBe(1);
      expect(ports.insertCollectorMessage).toHaveBeenCalledTimes(1);
      expect(ports.state.messages).toHaveLength(1);
    });

    const conflicts: Array<[string, RecordMessagePost, string]> = [
      ['body', { ...post, body: 'Something else' }, recordId],
      [
        'attachments',
        {
          ...post,
          knowledgeAttachments: [
            {
              entryId: generatedId,
              revision: 1,
              claimKey: 'material',
              citationIds: [generatedId],
            },
          ],
        },
        recordId,
      ],
      ['record', post, '00000000-0000-4000-8000-0000000000aa'],
      [
        'transcriptions',
        { ...post, transcriptionIds: [firstTranscriptionId] },
        recordId,
      ],
      ['revision', { ...post, expectedRecordRevision: 2 }, recordId],
    ];
    it.for(conflicts)(
      'should reject a replayed request key with a different %s',
      async ([, changed, onRecord]) => {
        const ports = fixture({ texts: { [firstTranscriptionId]: 'Spoken' } });
        await ports.service.post(ownerId, recordId, post);

        const conflict = await ports.service.post(ownerId, onRecord, changed);

        expect(conflict).toEqual({
          success: false,
          error: {
            code: 'VALIDATION_FAILED',
            message: 'Idempotency key was used for a different request',
            retryable: false,
          },
        });
        expect(ports.state.jobs).toBe(1);
        expect(ports.state.messages).toHaveLength(1);
      },
    );

    const reusedKey = {
      success: false,
      error: {
        code: 'VALIDATION_FAILED',
        message: 'Idempotency key was used for a different request',
        retryable: false,
      },
    };

    it.for<[string, string]>([
      ['the same instruction', post.body],
      ['another instruction', 'Something else entirely'],
    ])(
      'should reject a key already spent by an edit draft submitted with %s and start nothing',
      async ([, instruction]) => {
        const ports = fixture();
        ports.state.receipts.set(`editDrafts.submit:${requestKey}`, {
          ownerId,
          operation: 'editDrafts.submit',
          requestKey,
          fingerprint: instruction,
          status: 202,
          result: {},
        });

        const result = await ports.service.post(ownerId, recordId, post);

        expect(result).toEqual(reusedKey);
        expect(ports.state.drafts.size).toBe(0);
        expect(ports.state.jobs).toBe(0);
        expect(ports.insertCollectorMessage).not.toHaveBeenCalled();
      },
    );

    it('should answer a replay conflict from the message store like any other reused key and write nothing', async () => {
      const ports = fixture({
        insertFailure: new RecordMessageReplayConflictError(),
      });

      const result = await ports.service.post(ownerId, recordId, post);

      expect(result).toEqual(reusedKey);
      expect(ports.state.drafts.size).toBe(0);
      expect(ports.state.jobs).toBe(0);
      expect(ports.state.messages).toEqual([]);
    });

    it.for([
      [
        'the driver error itself',
        Object.assign(new Error('x'), { code: '23505' }),
      ],
      [
        'the cause of a wrapped query error',
        new Error('x', { cause: { code: '23505' } }),
      ],
    ])(
      'should ask the losing side of a racing key to retry when %s is a unique violation',
      async ([, violation]) => {
        const ports = fixture({ insertFailure: violation });

        const result = await ports.service.post(ownerId, recordId, post);

        expect(result).toEqual({
          success: false,
          error: {
            code: 'REQUEST_IN_PROGRESS',
            message: 'Another request with this key is in progress',
            retryable: true,
          },
        });
        expect(ports.state.drafts.size).toBe(0);
        expect(ports.state.messages).toEqual([]);
      },
    );

    it.for([
      ['an error without a cause', new Error('connection lost')],
      ['another database error', new Error('x', { cause: { code: '40001' } })],
      ['a null cause', new Error('x', { cause: null })],
      ['a value that is not an error', 'boom'],
    ])('should rethrow %s', async ([, failure]) => {
      const ports = fixture({ insertFailure: failure });

      await expect(ports.service.post(ownerId, recordId, post)).rejects.toBe(
        failure,
      );
    });

    it('should treat an instruction of only whitespace as blank when no source is cited', async () => {
      const ports = fixture();

      const result = await ports.service.post(ownerId, recordId, {
        ...post,
        body: '   ',
      });

      expect(result).toMatchObject({
        success: false,
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Select a transcription or observation for the edit',
        },
      });
      expect(ports.state.drafts.size).toBe(0);
      expect(ports.state.messages).toEqual([]);
    });

    it('should write nothing when the record is missing or has moved on', async () => {
      const missing = fixture({ record: null });
      const stale = fixture({ record: { ...record(), recordRevision: 2 } });

      expect(await missing.service.post(ownerId, recordId, post)).toMatchObject(
        { success: false, error: { code: 'NOT_FOUND' } },
      );
      expect(await stale.service.post(ownerId, recordId, post)).toMatchObject({
        success: false,
        error: { code: 'REVISION_CONFLICT', retryable: true },
      });
      for (const ports of [missing, stale]) {
        expect(ports.state.drafts.size).toBe(0);
        expect(ports.state.messages).toEqual([]);
        expect(ports.state.receipts.size).toBe(0);
      }
    });

    it('should store the spoken text of ready transcriptions in the given order when the body is empty', async () => {
      const ports = fixture({
        texts: {
          [firstTranscriptionId]: ' second ',
          [secondTranscriptionId]: 'first',
        },
      });

      const result = await ports.service.post(ownerId, recordId, {
        ...post,
        body: '',
        transcriptionIds: [secondTranscriptionId, firstTranscriptionId],
      });

      expect(result).toMatchObject({
        success: true,
        data: { message: { body: 'first\nsecond' } },
      });
      expect(ports.state.drafts.get(requestKey)?.request).toMatchObject({
        instructionZhHant: '',
        transcriptionIds: [secondTranscriptionId, firstTranscriptionId],
      });
    });

    it('should keep the typed body when transcriptions accompany it', async () => {
      const ports = fixture({ texts: { [firstTranscriptionId]: 'Spoken' } });

      const result = await ports.service.post(ownerId, recordId, {
        ...post,
        transcriptionIds: [firstTranscriptionId],
      });

      expect(result).toMatchObject({
        success: true,
        data: { message: { body: 'Please tidy the description' } },
      });
    });

    it('should write nothing when an empty body meets only blank transcriptions', async () => {
      const ports = fixture({
        texts: { [firstTranscriptionId]: '  ', [secondTranscriptionId]: '' },
      });

      const result = await ports.service.post(ownerId, recordId, {
        ...post,
        body: '',
        transcriptionIds: [firstTranscriptionId, secondTranscriptionId],
      });

      expect(result).toEqual({
        success: false,
        error: {
          code: 'VALIDATION_FAILED',
          message: 'The message has no text to send',
          retryable: false,
        },
      });
      expect(ports.state.drafts.size).toBe(0);
      expect(ports.state.jobs).toBe(0);
      expect(ports.state.events).toBe(0);
      expect(ports.state.messages).toEqual([]);
      expect(ports.state.receipts.size).toBe(0);
    });

    it('should reject an empty message that cites nothing', async () => {
      const ports = fixture();

      const result = await ports.service.post(ownerId, recordId, {
        ...post,
        body: '',
      });

      expect(result).toMatchObject({
        success: false,
        error: { code: 'VALIDATION_FAILED' },
      });
      expect(ports.state.messages).toEqual([]);
    });

    describe('ready transcriptions', () => {
      const spoken = { reading: '  請改成青瓷瓶 ', original: 'raw words' };

      it('should accept a ready transcription that is not confirmed and freeze its text without creating an observation', async () => {
        const ports = fixture({
          unconfirmed: { [firstTranscriptionId]: spoken },
        });

        const result = await ports.service.post(ownerId, recordId, {
          ...post,
          transcriptionIds: [firstTranscriptionId],
        });

        expect(result).toMatchObject({
          success: true,
          data: { message: { body: 'Please tidy the description' } },
        });
        const stored = ports.state.drafts.get(requestKey)!;
        expect(stored.detail.snapshot).toMatchObject({
          transcriptionVersions: [{ id: firstTranscriptionId, revision: 4 }],
          observationIds: [],
          sourceText: [
            {
              kind: 'transcription',
              id: firstTranscriptionId,
              text: spoken.reading,
            },
          ],
        });
        expect(stored.request).toMatchObject({
          instructionZhHant: 'Please tidy the description',
          transcriptionIds: [firstTranscriptionId],
          observationIds: [],
        });
        expect(ports.getObservation).not.toHaveBeenCalled();
        expect(ports.state.jobs).toBe(1);
      });

      it('should build the body from the ready text when the body is empty, preferring the reading text', async () => {
        const ports = fixture({
          unconfirmed: {
            [firstTranscriptionId]: spoken,
            [secondTranscriptionId]: { reading: '', original: 'fallback' },
          },
        });

        const result = await ports.service.post(ownerId, recordId, {
          ...post,
          body: '',
          transcriptionIds: [firstTranscriptionId, secondTranscriptionId],
        });

        expect(result).toMatchObject({
          success: true,
          data: { message: { body: '請改成青瓷瓶\nfallback' } },
        });
      });

      it('should still accept a confirmed transcription next to a ready one', async () => {
        const ports = fixture({
          texts: { [firstTranscriptionId]: 'Confirmed' },
          unconfirmed: { [secondTranscriptionId]: spoken },
        });

        const result = await ports.service.post(ownerId, recordId, {
          ...post,
          body: '',
          transcriptionIds: [firstTranscriptionId, secondTranscriptionId],
        });

        expect(result).toMatchObject({
          success: true,
          data: { message: { body: 'Confirmed\n請改成青瓷瓶' } },
        });
        expect(ports.getObservation).toHaveBeenCalledOnce();
      });

      it.for<[string, ReadyTranscription]>([
        ['is still pending', { ...spoken, status: 'pending' }],
        [
          'belongs to another record',
          { ...spoken, recordId: '00000000-0000-4000-8000-0000000000aa' },
        ],
      ])(
        'should reject a transcription that %s and start nothing',
        async ([, facts]) => {
          const ports = fixture({
            unconfirmed: { [firstTranscriptionId]: facts },
          });

          const result = await ports.service.post(ownerId, recordId, {
            ...post,
            transcriptionIds: [firstTranscriptionId],
          });

          expect(result).toEqual({
            success: false,
            error: {
              code: 'EVIDENCE_INVALID',
              message: 'Ready transcription does not belong to record',
              retryable: false,
            },
          });
          expect(ports.state.drafts.size).toBe(0);
          expect(ports.state.jobs).toBe(0);
          expect(ports.state.messages).toEqual([]);
        },
      );

      it('should reject a duplicated transcription ID', async () => {
        const ports = fixture({
          unconfirmed: { [firstTranscriptionId]: spoken },
        });

        const result = await ports.service.post(ownerId, recordId, {
          ...post,
          transcriptionIds: [firstTranscriptionId, firstTranscriptionId],
        });

        expect(result).toMatchObject({
          success: false,
          error: { code: 'VALIDATION_FAILED' },
        });
      });
    });

    it('should reject a transcription that is not confirmed for the record', async () => {
      const ports = fixture();

      const result = await ports.service.post(ownerId, recordId, {
        ...post,
        transcriptionIds: [firstTranscriptionId],
      });

      expect(result).toMatchObject({
        success: false,
        error: { code: 'EVIDENCE_INVALID' },
      });
      expect(ports.state.drafts.size).toBe(0);
    });

    it('should report a draft that disappeared and write nothing', async () => {
      const ports = fixture({ draftVanishes: true });

      const result = await ports.service.post(ownerId, recordId, post);

      expect(result).toMatchObject({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Edit draft not found' },
      });
      expect(ports.state.messages).toEqual([]);
      expect(ports.state.drafts.size).toBe(0);
    });
  });

  describe('list', () => {
    const message = (editDraftId: string, body: string): RecordMessage => ({
      id: generatedId,
      recordId,
      author: 'collector',
      body,
      editDraftId,
      createdAt: now,
    });
    const facts = {
      status: 'pending',
      revision: 1,
      proposedChanges: [],
      appliedProposalIds: [],
      skippedProposalIds: [],
      jobFailed: false,
    } satisfies ListedRecordMessage['draft'];

    it('should return the page with the cursor and the paging inputs it was given', async () => {
      const skippedId = '00000000-0000-4000-8000-000000000007';
      const proposal: ProposedChange = {
        id: requestKey,
        field: 'description',
        before: '',
        proposed: 'Text',
        findingIds: [],
      };
      const ports = fixture({
        listed: [
          {
            message: message(requestKey, 'Question'),
            draft: {
              ...facts,
              status: 'partially_applied',
              revision: 3,
              proposedChanges: [proposal, { ...proposal, id: skippedId }],
              appliedProposalIds: [requestKey],
              skippedProposalIds: [skippedId],
            },
          },
        ],
      });

      const result = await ports.service.list(ownerId, recordId, {
        cursor: 'newer',
        limit: 5,
      });

      expect(result).toEqual({
        success: true,
        data: {
          items: [
            {
              ...message(requestKey, 'Question'),
              draft: {
                status: 'partially_applied',
                revision: 3,
                proposedChanges: [proposal, { ...proposal, id: skippedId }],
                appliedProposalIds: [requestKey],
                skippedProposalIds: [skippedId],
              },
            },
          ],
          nextCursor: 'older',
        },
      });
      expect(ports.listByRecord).toHaveBeenCalledExactlyOnceWith({
        recordId,
        cursor: 'newer',
        limit: 5,
      });
    });

    it('should report a draft as failed only when it has no result and its job failed', async () => {
      const ports = fixture({
        listed: [
          { message: message(requestKey, 'a'), draft: facts },
          {
            message: message(requestKey, 'b'),
            draft: { ...facts, jobFailed: true },
          },
          {
            message: message(requestKey, 'c'),
            draft: { ...facts, status: 'ready', jobFailed: true },
          },
        ],
      });

      const result = await ports.service.list(ownerId, recordId, {});

      expect(
        (
          result as { data: { items: Array<{ draft: { status: string } }> } }
        ).data.items.map((item) => item.draft.status),
      ).toEqual(['pending', 'failed', 'ready']);
    });

    it('should not reveal a missing or foreign record as an empty conversation', async () => {
      const ports = fixture({ record: null });

      expect(await ports.service.list(ownerId, recordId, {})).toEqual({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Record not found',
          retryable: false,
        },
      });
      expect(ports.listByRecord).not.toHaveBeenCalled();
    });

    it('should turn an invalid cursor into a validation failure and rethrow anything else', async () => {
      const invalid = fixture({ listFailure: new RecordMessageCursorError() });
      const broken = fixture({ listFailure: new Error('connection lost') });

      expect(
        await invalid.service.list(ownerId, recordId, { cursor: 'x' }),
      ).toEqual({
        success: false,
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Cursor is invalid',
          retryable: false,
        },
      });
      await expect(broken.service.list(ownerId, recordId, {})).rejects.toThrow(
        'connection lost',
      );
    });
  });
});
