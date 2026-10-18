import type {
  CursorPage,
  EditDraftDetail,
  ProposedChange,
  RecordMessage,
} from '@antica/contracts';

/** values stored for a collector message */
export interface CollectorMessageInput {
  /** identifier of the new message */
  readonly id: string;
  /** record the conversation belongs to */
  readonly recordId: string;
  /** idempotency key of the post; a replay returns the stored message */
  readonly requestKey: string;
  /** message text; surrounding whitespace is dropped */
  readonly body: string;
  /** edit draft started by this post */
  readonly editDraftId: string;
  /** creation instant, stored with millisecond precision */
  readonly createdAt: string;
}

/** values stored for the assistant reply of one edit draft */
export interface AssistantReplyInput {
  /** identifier of the new message */
  readonly id: string;
  /** record the conversation belongs to */
  readonly recordId: string;
  /** edit draft the reply answers; at most one reply exists per draft */
  readonly editDraftId: string;
  /** message text; surrounding whitespace is dropped */
  readonly body: string;
  /** creation instant, stored with millisecond precision */
  readonly createdAt: string;
}

/** selects one page of a record's conversation */
export interface ListRecordMessagesInput {
  /** record whose conversation is read */
  readonly recordId: string;
  /** position returned by the previous page; omitted for the first page */
  readonly cursor?: string | null;
  /** page size, defaulting to 50 and capped at the shared page maximum */
  readonly limit?: number;
}

/** stored message and whether this call created it */
export interface StoredRecordMessage {
  /** the stored message, which is the earlier one on a replay */
  readonly message: RecordMessage;
  /** false when the call matched an existing row and wrote nothing */
  readonly created: boolean;
}

/** what the repository knows about the edit draft behind a listed message */
export interface RecordMessageDraftFacts {
  /** persisted draft status, which never reports a failed job */
  readonly status: EditDraftDetail['status'];
  /** draft revision to apply proposals against */
  readonly revision: number;
  /** proposals of the saved result; empty while the draft has none */
  readonly proposedChanges: readonly ProposedChange[];
  /** proposals already written to the record */
  readonly appliedProposalIds: readonly string[];
  /** whether the draft's job ended in failure */
  readonly jobFailed: boolean;
}

/** a stored message with the facts of its edit draft */
export interface ListedRecordMessage {
  readonly message: RecordMessage;
  readonly draft: RecordMessageDraftFacts;
}

/** owner-scoped persistence of the per-record conversation */
export interface RecordMessageRepository {
  /**
   * stores a collector message once per request key
   * @throws {Error} when the record or edit draft is not owned by the collector, the draft belongs to another record, or the body is blank
   * @throws {Error} RecordMessageReplayConflictError when the request key already stores a different record, edit draft, or body
   */
  insertCollectorMessage(
    input: CollectorMessageInput,
  ): Promise<StoredRecordMessage>;
  /**
   * stores the assistant reply of an edit draft once
   * @throws {Error} when the record or edit draft is not owned by the collector, the draft belongs to another record, or the body is blank
   */
  insertAssistantReply(
    input: AssistantReplyInput,
  ): Promise<StoredRecordMessage>;
  /**
   * finds the earliest collector message that started an edit draft
   * @param editDraftId draft to look up
   * @returns the message, or null when the draft was not started from a conversation
   */
  findCollectorMessage(editDraftId: string): Promise<RecordMessage | null>;
  /**
   * lists the newest messages of a record, oldest first within the page
   * @returns the page; its cursor continues with older messages
   * @throws {Error} RecordMessageCursorError when the cursor is malformed
   */
  listByRecord(
    input: ListRecordMessagesInput,
  ): Promise<CursorPage<ListedRecordMessage>>;
}
