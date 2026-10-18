import { ApiError } from '@antica/client';
import { recordMessageEntrySchema } from '@antica/contracts';

import { collectionRecord } from '../../../../mobile.spec.fixtures';

import type {
  ProposedChange,
  RecordMessageDraft,
  RecordMessageEntry,
} from '@antica/contracts';

import type { MobileHarness } from '../../../../mobile.spec.fixtures';

export const recordId = collectionRecord.id;
export const messagesPath = `/v1/records/${recordId}/messages`;
export const draftId = '00000000-0000-4000-8000-000000000501';
export const otherDraftId = '00000000-0000-4000-8000-000000000502';
export const nameChangeId = '00000000-0000-4000-8000-000000000511';
export const periodChangeId = '00000000-0000-4000-8000-000000000512';
export const tagsChangeId = '00000000-0000-4000-8000-000000000513';
export const descriptionChangeId = '00000000-0000-4000-8000-000000000514';

export const nameChange: ProposedChange = {
  id: nameChangeId,
  field: 'name',
  before: null,
  proposed: 'Blue vase',
  findingIds: [],
};
export const periodChange: ProposedChange = {
  id: periodChangeId,
  field: 'period',
  before: null,
  proposed: {
    label: 'Kangxi',
    fromYear: 1662,
    toYear: 1722,
    status: 'unconfirmed',
  },
  findingIds: [],
};
export const tagsChange: ProposedChange = {
  id: tagsChangeId,
  field: 'tags',
  before: [],
  proposed: ['porcelain', 'blue-and-white'],
  findingIds: [],
};
export const descriptionChange: ProposedChange = {
  id: descriptionChangeId,
  field: 'description',
  before: 'Old words',
  proposed: 'A long, carefully organized description.',
  findingIds: [],
};

let sequence = 600;

/**
 * creates a deterministic message identifier
 * @returns the next fixture UUID
 */
function nextId(): string {
  sequence += 1;

  return `00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`;
}

/**
 * builds a validated conversation entry
 * @param author who wrote the message
 * @param body message text
 * @param draft edit-draft state behind the message
 * @param createdAt when the message was stored; defaults to now
 * @returns a contract-valid entry
 */
export function entry(
  author: RecordMessageEntry['author'],
  body: string,
  draft: Partial<RecordMessageDraft> = {},
  createdAt = new Date().toISOString(),
): RecordMessageEntry {
  return recordMessageEntrySchema.parse({
    id: nextId(),
    recordId,
    author,
    body,
    editDraftId: draftId,
    createdAt,
    draft: {
      status: 'ready',
      revision: 4,
      proposedChanges: [],
      appliedProposalIds: [],
      ...draft,
    },
  });
}

/**
 * builds one page of the conversation
 * @param items entries, oldest first
 * @param nextCursor cursor of the older page, if any
 * @returns a conversation page
 */
export function page(
  items: RecordMessageEntry[],
  nextCursor: string | null = null,
): { items: RecordMessageEntry[]; nextCursor: string | null } {
  return { items, nextCursor };
}

/**
 * creates the public error the transport throws for an HTTP failure
 * @param status HTTP status
 * @param code public error code
 * @param message public error message
 * @returns the transport error
 */
export function apiError(
  status: number,
  code: string,
  message: string,
): ApiError {
  return new ApiError({
    status,
    code,
    message,
    retryable: code === 'REQUEST_IN_PROGRESS',
  });
}

/** the server's answer while an earlier post under the same key is still being handled */
export const inProgress = apiError(
  409,
  'REQUEST_IN_PROGRESS',
  'Request in progress',
);

/**
 * reads the body and idempotency key of every command sent to a path
 * @param commands spied transport commands
 * @param path endpoint path to select
 * @returns the bodies and keys in call order
 */
export function sentTo(
  commands: MobileHarness['commands'],
  path: string,
): Array<{ body: Record<string, unknown>; idempotencyKey?: string }> {
  return commands.mock.calls
    .filter(([called]) => called === path)
    .map(([, , options]) => ({
      body: options.body as Record<string, unknown>,
      idempotencyKey: options.idempotencyKey,
    }));
}
