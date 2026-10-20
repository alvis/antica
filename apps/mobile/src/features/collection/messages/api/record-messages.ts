import {
  editDraftAppliedSchema,
  recordMessagePageSchema,
  recordMessagePostedSchema,
} from '@antica/contracts';

import { isRequestInProgress } from './message-errors';

import type {
  InfiniteData,
  UseInfiniteQueryOptions,
  UseQueryOptions,
} from '@tanstack/react-query';

import type { ApiError, ApiTransport } from '@antica/client';
import type {
  EditDraftApplied,
  EditDraftApply,
  RecordMessageEntry,
  RecordMessagePage,
  RecordMessagePost,
  RecordMessagePosted,
} from '@antica/contracts';

/** how often the thread is reread while a reply is still being prepared */
export const pendingPollIntervalMs = 2000;

/** how long a reply may be pending before the collector is told it is still working */
export const stillWorkingAfterMs = 60_000;

/** retries made with one request key while the server reports it still in flight */
export const postInProgressRetries = 4;

/** pause before the first such retry; each later pause doubles, about 7.5s in total */
export const postInProgressFirstDelayMs = 500;

const backoffFactor = 2;

/**
 * builds the conversation endpoint of a record
 * @param recordId record the conversation belongs to
 * @returns path with the record identifier escaped
 */
function messagesPath(recordId: string): string {
  return `/v1/records/${encodeURIComponent(recordId)}/messages`;
}

/**
 * names every cached read of one record's conversation
 * @param recordId record the conversation belongs to
 * @returns query key prefix shared by the thread and its preview
 */
export function recordMessagesKey(recordId: string): readonly string[] {
  return ['record-messages', recordId];
}

/**
 * tells whether an entry still waits for the assistant's reply
 * @param entry message and the state of its edit draft
 * @returns true while the draft has neither a result nor a failure
 */
export function isPendingEntry(entry: RecordMessageEntry): boolean {
  return entry.draft.status === 'pending';
}

/**
 * describes the record's conversation, newest page first, polling while a reply is pending
 * @param api authenticated API transport
 * @param recordId record the conversation belongs to
 * @returns infinite query options whose next page holds older messages
 */
export function recordMessagesQuery(
  api: ApiTransport,
  recordId: string,
): UseInfiniteQueryOptions<
  RecordMessagePage,
  Error,
  InfiniteData<RecordMessagePage, string | null>,
  readonly string[],
  string | null
> {
  return {
    queryKey: recordMessagesKey(recordId),
    initialPageParam: null,
    queryFn: async ({ pageParam, signal }) =>
      api.get(
        `${messagesPath(recordId)}${
          pageParam ? `?cursor=${encodeURIComponent(pageParam)}` : ''
        }`,
        recordMessagePageSchema,
        signal,
      ),
    getNextPageParam: (page) => page.nextCursor,
    refetchInterval: (query) =>
      query.state.data?.pages.some((page) => page.items.some(isPendingEntry))
        ? pendingPollIntervalMs
        : false,
  };
}

/**
 * describes the newest message of the record's conversation for the record screen
 * @param api authenticated API transport
 * @param recordId record the conversation belongs to
 * @returns query options for a one-message page
 */
export function recordMessagePreviewQuery(
  api: ApiTransport,
  recordId: string,
): UseQueryOptions<RecordMessagePage> {
  return {
    queryKey: [...recordMessagesKey(recordId), 'preview'],
    queryFn: async ({ signal }) =>
      api.get(
        `${messagesPath(recordId)}?limit=1`,
        recordMessagePageSchema,
        signal,
      ),
  };
}

/**
 * how many of the newest messages 今天 and the record hub read to find edit cards that still wait;
 * a thread holds one edit card per collector request, so an undecided card older than the last 20
 * messages is left out of the 今天 card and the hub's 有建議 badge until it is opened in 對話
 */
const inboxMessageLimit = 20;

/**
 * describes the newest messages of the record's conversation, where 今天 looks for undecided edit cards
 * @param api authenticated API transport
 * @param recordId record the conversation belongs to
 * @returns query options for the newest page
 */
export function recordMessageInboxQuery(
  api: ApiTransport,
  recordId: string,
): UseQueryOptions<RecordMessagePage> {
  return {
    queryKey: [...recordMessagesKey(recordId), 'inbox'],
    queryFn: async ({ signal }) =>
      api.get(
        `${messagesPath(recordId)}?limit=${inboxMessageLimit}`,
        recordMessagePageSchema,
        signal,
      ),
  };
}

/**
 * posts a collector message, retrying with the same key, with growing pauses, while the server reports that key in flight
 * @param api authenticated API transport
 * @param recordId record the message is about
 * @param post message body, sources, request key, and the record revision on screen
 * @returns the stored message and the edit draft it started
 * @throws {ApiError} when the post fails for another reason, or with REQUEST_IN_PROGRESS once every retry is spent; the key stays valid either way except after REVISION_CONFLICT
 */
export async function postRecordMessage(
  api: ApiTransport,
  recordId: string,
  post: RecordMessagePost,
): Promise<RecordMessagePosted> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await api.post(messagesPath(recordId), recordMessagePostedSchema, {
        body: post,
        idempotencyKey: post.requestKey,
      });
    } catch (cause) {
      if (!isRequestInProgress(cause) || attempt >= postInProgressRetries) {
        throw cause;
      }
      await new Promise((resolve) =>
        setTimeout(
          resolve,
          postInProgressFirstDelayMs * backoffFactor ** attempt,
        ),
      );
    }
  }
}

/**
 * applies the confirmed proposals of a message's edit draft
 * @param api authenticated API transport
 * @param editDraftId edit draft behind the assistant reply
 * @param request confirmed proposal IDs and the expected draft and record revisions
 * @returns the updated draft and record
 */
export async function applyRecordMessageDraft(
  api: ApiTransport,
  editDraftId: string,
  request: EditDraftApply,
): Promise<EditDraftApplied> {
  return api.post(
    `/v1/edit-drafts/${encodeURIComponent(editDraftId)}/apply`,
    editDraftAppliedSchema,
    { body: request, idempotencyKey: request.requestKey },
  );
}
