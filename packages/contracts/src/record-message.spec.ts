import { describe, expect, it } from 'vitest';

import {
  recordMessageAuthorSchema,
  recordMessageBodyMaxLength,
  recordMessageDraftSchema,
  recordMessageDraftStatusSchema,
  recordMessageEntrySchema,
  recordMessageListQuerySchema,
  recordMessagePageSchema,
  recordMessagePostedSchema,
  recordMessagePostSchema,
  recordMessageReplyMaxLength,
  recordMessageSchema,
} from './record-message.js';

const id = '00000000-0000-4000-8000-000000000001';
const otherId = '00000000-0000-4000-8000-000000000002';
const draftId = '00000000-0000-4000-8000-000000000003';
const createdAt = '2026-10-16T00:00:00Z';
const message = {
  id,
  recordId: otherId,
  author: 'collector',
  body: 'Please tidy the description',
  editDraftId: draftId,
  createdAt,
} as const;
const post = {
  requestKey: id,
  body: 'Please tidy the description',
  transcriptionIds: [],
  expectedRecordRevision: 1,
} as const;

describe('record message length caps', () => {
  it('should fix the caps at 2000 for a typed body and 4000 for a stored reply', () => {
    expect(recordMessageBodyMaxLength).toBe(2000);
    expect(recordMessageReplyMaxLength).toBe(4000);
  });

  it('should accept a body of exactly the cap and reject one character more', () => {
    const atCap = 'a'.repeat(recordMessageBodyMaxLength);

    expect(
      recordMessagePostSchema.safeParse({ ...post, body: atCap }).success,
    ).toBe(true);
    const over = recordMessagePostSchema.safeParse({
      ...post,
      body: `${atCap}a`,
    });
    expect(over.success).toBe(false);
    expect(over.error?.issues[0]?.path).toEqual(['body']);
  });

  it('should measure the cap after trimming the body', () => {
    const padded = `  ${'a'.repeat(recordMessageBodyMaxLength)}  `;

    expect(
      recordMessagePostSchema.safeParse({ ...post, body: padded }).success,
    ).toBe(true);
  });
});

describe('record message author validation', () => {
  it('should accept the two conversation participants only', () => {
    expect(recordMessageAuthorSchema.safeParse('collector').success).toBe(true);
    expect(recordMessageAuthorSchema.safeParse('assistant').success).toBe(true);
    expect(recordMessageAuthorSchema.safeParse('system').success).toBe(false);
  });
});

describe('record message validation', () => {
  it('should trim the body of a message that belongs to an edit draft', () => {
    const parsed = recordMessageSchema.parse({ ...message, body: '  hello  ' });

    expect(parsed.body).toBe('hello');
    expect(parsed.editDraftId).toBe(draftId);
  });

  it('should reject a message without an edit draft', () => {
    const { editDraftId: _editDraftId, ...withoutDraft } = message;

    expect(recordMessageSchema.safeParse(withoutDraft).success).toBe(false);
    expect(
      recordMessageSchema.safeParse({ ...message, editDraftId: null }).success,
    ).toBe(false);
  });

  it('should reject a blank body, unknown fields and a malformed instant', () => {
    expect(
      recordMessageSchema.safeParse({ ...message, body: '  ' }).success,
    ).toBe(false);
    expect(
      recordMessageSchema.safeParse({ ...message, extra: 1 }).success,
    ).toBe(false);
    expect(
      recordMessageSchema.safeParse({ ...message, createdAt: 'yesterday' })
        .success,
    ).toBe(false);
  });
});

describe('record message post validation', () => {
  it('should accept a typed message without transcriptions', () => {
    expect(recordMessagePostSchema.safeParse(post).success).toBe(true);
  });

  it('should accept a voice-only message whose body is empty', () => {
    expect(
      recordMessagePostSchema.safeParse({
        ...post,
        body: '   ',
        transcriptionIds: [otherId],
      }).success,
    ).toBe(true);
  });

  it('should reject an empty body when there are no transcriptions', () => {
    const result = recordMessagePostSchema.safeParse({ ...post, body: ' ' });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['body']);
  });

  it('should reject a missing idempotency key, a stale revision and unknown fields', () => {
    const { requestKey: _requestKey, ...withoutKey } = post;

    expect(recordMessagePostSchema.safeParse(withoutKey).success).toBe(false);
    expect(
      recordMessagePostSchema.safeParse({ ...post, expectedRecordRevision: 0 })
        .success,
    ).toBe(false);
    expect(
      recordMessagePostSchema.safeParse({ ...post, extra: 1 }).success,
    ).toBe(false);
  });
});

describe('record message posted validation', () => {
  const posted = {
    editDraftId: draftId,
    jobId: id,
    message,
  };

  it('should accept the collector message together with the draft and job it started', () => {
    expect(recordMessagePostedSchema.safeParse(posted).success).toBe(true);
  });

  it('should reject an assistant message, a draftless message and a mismatched draft', () => {
    expect(
      recordMessagePostedSchema.safeParse({
        ...posted,
        message: { ...posted.message, author: 'assistant' },
      }).success,
    ).toBe(false);
    expect(
      recordMessagePostedSchema.safeParse({
        ...posted,
        message: { ...posted.message, editDraftId: null },
      }).success,
    ).toBe(false);
    const mismatch = recordMessagePostedSchema.safeParse({
      ...posted,
      message: { ...posted.message, editDraftId: id },
    });

    expect(mismatch.success).toBe(false);
    expect(mismatch.error?.issues[0]?.path).toEqual(['message', 'editDraftId']);
  });

  it('should reject a response that omits the job', () => {
    const { jobId: _jobId, ...withoutJob } = posted;

    expect(recordMessagePostedSchema.safeParse(withoutJob).success).toBe(false);
  });
});

describe('record message draft validation', () => {
  const draft = {
    status: 'ready',
    revision: 2,
    proposedChanges: [
      {
        id,
        field: 'description',
        before: '',
        proposed: '手感粗糙',
        findingIds: [],
      },
    ],
    appliedProposalIds: [],
  } as const;

  it.for(['pending', 'ready', 'partially_applied', 'applied', 'failed'])(
    'should accept the %s status',
    (status) => {
      expect(recordMessageDraftStatusSchema.safeParse(status).success).toBe(
        true,
      );
    },
  );

  it('should reject a status the app cannot render', () => {
    expect(recordMessageDraftStatusSchema.safeParse('running').success).toBe(
      false,
    );
  });

  it('should accept a ready edit card and a draft that has no proposals yet', () => {
    expect(recordMessageDraftSchema.safeParse(draft).success).toBe(true);
    expect(
      recordMessageDraftSchema.safeParse({
        ...draft,
        status: 'pending',
        proposedChanges: [],
      }).success,
    ).toBe(true);
  });

  it('should reject a proposal outside the editable record fields, a stale revision and unknown fields', () => {
    expect(
      recordMessageDraftSchema.safeParse({
        ...draft,
        proposedChanges: [{ ...draft.proposedChanges[0], field: 'code' }],
      }).success,
    ).toBe(false);
    expect(
      recordMessageDraftSchema.safeParse({ ...draft, revision: 0 }).success,
    ).toBe(false);
    expect(
      recordMessageDraftSchema.safeParse({ ...draft, extra: 1 }).success,
    ).toBe(false);
  });

  it('should carry the draft on a message entry and require it', () => {
    expect(
      recordMessageEntrySchema.safeParse({ ...message, draft }).success,
    ).toBe(true);
    expect(recordMessageEntrySchema.safeParse(message).success).toBe(false);
  });
});

describe('record message list query validation', () => {
  it('should accept an empty query, a cursor and a limit within the page maximum', () => {
    expect(recordMessageListQuerySchema.safeParse({}).success).toBe(true);
    expect(
      recordMessageListQuerySchema.safeParse({ cursor: 'c', limit: 100 })
        .success,
    ).toBe(true);
  });

  it.for([0, 101, 1.5, '10'])('should reject the limit %j', (limit) => {
    expect(recordMessageListQuerySchema.safeParse({ limit }).success).toBe(
      false,
    );
  });

  it('should reject unknown parameters', () => {
    expect(
      recordMessageListQuerySchema.safeParse({ before: 'x' }).success,
    ).toBe(false);
  });
});

describe('record message page validation', () => {
  const entry = {
    ...message,
    draft: {
      status: 'pending',
      revision: 1,
      proposedChanges: [],
      appliedProposalIds: [],
    },
  };

  it('should accept entries with a next cursor or an exhausted page', () => {
    expect(
      recordMessagePageSchema.safeParse({ items: [entry], nextCursor: 'c' })
        .success,
    ).toBe(true);
    expect(
      recordMessagePageSchema.safeParse({ items: [], nextCursor: null })
        .success,
    ).toBe(true);
  });

  it('should reject an item without its draft or with an invalid message', () => {
    expect(
      recordMessagePageSchema.safeParse({
        items: [message],
        nextCursor: null,
      }).success,
    ).toBe(false);
    expect(
      recordMessagePageSchema.safeParse({
        items: [{ ...entry, body: '' }],
        nextCursor: null,
      }).success,
    ).toBe(false);
  });
});
