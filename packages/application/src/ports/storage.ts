import type {
  CursorPage,
  JobEnvelope,
  JobEvent,
  JobKind,
  Note,
  ReferenceLink,
  ResearchDetail,
  ResearchRequest,
  SourceDetail,
} from '@antica/contracts';
import type {
  Source,
  SourceCitation,
  SourcePage,
  SourceVersion,
} from '@antica/domain';

import type { ParsedSourcePack } from './parsing.js';
import type { IndexIdentity, RetrievalSnapshot } from './retrieval.js';

/** source registration, parsing, citation, and version persistence */
export interface SourceRepository {
  get(
    id: string,
    versionId?: string,
    pageId?: string,
    cursor?: string,
    limit?: number,
  ): Promise<SourceDetail | null>;
  getReadTargets(
    sourceVersionId: string,
    pageIds?: readonly string[],
  ): Promise<readonly SourceReadTarget[]>;
  getVersion(id: string): Promise<SourceVersion | null>;
  findVersionByHash(sourceHash: string): Promise<SourceVersion | null>;
  getIngestionJobId(versionId: string): Promise<string | null>;
  getPage(id: string): Promise<SourcePage | null>;
  /**
   * returns the committed run selected for each page before a new parse becomes active
   * @param versionId source version whose pages are being reprocessed
   * @returns pages in page-index order, each with its selected run or null if unparsed
   */
  getPageRunSelection(
    versionId: string,
  ): Promise<readonly SourcePageRunSelection[]>;
  create(
    source: Source,
    version: SourceVersion,
    assets: readonly SourceRegistrationAsset[],
  ): Promise<void>;
  addVersion(
    version: SourceVersion,
    expectedSourceRevision: number,
    assets: readonly SourceRegistrationAsset[],
  ): Promise<boolean>;
  /**
   * updates a version only from the expected status and active parse run
   * @param version replacement source version
   * @param expectedStatus current status required for the update
   * @param expectedActiveParseRunId current parse run required for the update
   * @returns whether the version was updated
   */
  updateVersion(
    version: SourceVersion,
    expectedStatus: SourceVersion['status'],
    expectedActiveParseRunId: string | null,
  ): Promise<boolean>;
  saveParsed(
    pack: ParsedSourcePack & {
      readonly mappings: readonly ProviderChunkMapping[];
    },
  ): Promise<void>;
  addProviderChunkMappings(
    index: IndexIdentity,
    mappings: readonly ProviderChunkMapping[],
  ): Promise<void>;
  resolveProviderChunk(
    provider: string,
    indexVersion: string,
    providerChunkId: string,
  ): Promise<ProviderChunkMapping | null>;
  getCitation(id: string): Promise<SourceCitation | null>;
  addCitation(citation: SourceCitation): Promise<void>;
  linkKnowledgeDraft(versionId: string, entryId: string): Promise<void>;
}
/** one page and its selected committed parse run, when available */
export interface SourcePageRunSelection {
  readonly pageId: string;
  readonly parseRunId: string | null;
}
/** actual stored original or derivative available from a selected source version */
export interface SourceReadTarget {
  readonly assetOrDerivativeId: string;
  readonly storageKey: string;
}
/** original asset ordering and optional page presentation at registration */
export interface SourceRegistrationAsset {
  readonly assetId: string;
  readonly order: number;
  readonly printedPageLabel: string | null;
  readonly presentation?: NonNullable<SourcePage['presentation']>;
}
/** provider chunk identity mapped back to canonical source regions */
export interface ProviderChunkMapping {
  readonly provider: string;
  readonly providerChunkId: string;
  readonly providerFigureId: string | null;
  readonly parseRunId: string;
  readonly indexVersion: string;
  readonly sourceVersionId: string;
  /** canonical regions represented by this provider chunk */
  readonly canonicalRegionIds: readonly string[];
}
/** research drafts, retrieval snapshots, notes, and reference persistence */
export interface ResearchRepository {
  get(id: string): Promise<ResearchDetail | null>;
  create(id: string, jobId: string, request: ResearchRequest): Promise<void>;
  saveDetail(detail: ResearchDetail): Promise<void>;
  getRetrievalSnapshot(id: string): Promise<RetrievalSnapshot | null>;
  saveRetrievalSnapshot(snapshot: RetrievalSnapshot): Promise<void>;
  addNote(note: Note): Promise<void>;
  addReference(link: ReferenceLink, identity: string): Promise<void>;
  getReference(id: string): Promise<ReferenceLink | null>;
  findReference(
    recordId: string,
    identity: string,
  ): Promise<ReferenceLink | null>;
  queryReferences(
    recordId: string,
    filters: {
      readonly checkId?: string;
      readonly observationId?: string;
      readonly cursor?: string;
      readonly limit?: number;
    },
  ): Promise<CursorPage<ReferenceLink>>;
}
/** durable job lifecycle, provider callbacks, and step checkpoints */
export interface JobRepository {
  get(id: string): Promise<JobEnvelope | null>;
  getByResource(kind: JobKind, resourceId: string): Promise<JobEnvelope | null>;
  /**
   * retries a failed job with CAS while preserving completed terminal states
   * @param id persisted job identifier
   * @param expectedUpdatedAt revision timestamp expected by the caller
   * @param updatedAt replacement revision timestamp
   * @returns whether the failed job was restarted
   */
  restartFailed(
    id: string,
    expectedUpdatedAt: string,
    updatedAt: string,
  ): Promise<boolean>;
  create(job: JobEnvelope): Promise<void>;
  update(job: JobEnvelope, expectedUpdatedAt: string): Promise<boolean>;
  hasProviderEvent(provider: string, eventId: string): Promise<boolean>;
  recordProviderEvent(
    provider: string,
    eventId: string,
    jobId: string,
  ): Promise<void>;
  getStep(jobId: string, step: string): Promise<JobStep | null>;
  updateStep(step: JobStep, expectedRevision: number): Promise<boolean>;
  getProviderJob(
    provider: string,
    providerJobId: string,
  ): Promise<{ readonly jobId: string; readonly step: string } | null>;
  mapProviderJob(
    provider: string,
    providerJobId: string,
    jobId: string,
    step: string,
  ): Promise<void>;
}
/** persisted progress and lease state for one job step */
export interface JobStep {
  readonly jobId: string;
  readonly step: string;
  readonly revision: number;
  readonly state: 'ready' | 'leased' | 'waiting' | 'completed' | 'failed';
  readonly leaseUntil: string | null;
  /** resumable provider state saved before the step completes */
  readonly checkpoint: unknown;
  /** completed step output retained for later retries or consumers */
  readonly result: unknown;
}
/** idempotent command outcome bound to its request fingerprint */
export interface CommandReceipt<T = unknown> {
  readonly ownerId: string;
  readonly operation: string;
  readonly requestKey: string;
  /** canonical request fingerprint used to reject key reuse with different input */
  readonly fingerprint: string;
  readonly status: number;
  readonly result: T;
}
/** owner-scoped command receipt lookup and insertion */
export interface CommandRepository {
  get(
    ownerId: string,
    operation: string,
    requestKey: string,
  ): Promise<CommandReceipt | null>;
  insert(receipt: CommandReceipt): Promise<void>;
}
/** event awaiting or recording external dispatch */
export interface OutboxMessage {
  readonly id: string;
  readonly name: string;
  readonly event: JobEvent;
  readonly createdAt: string;
  readonly sentAt: string | null;
}
/** durable enqueue and dispatch acknowledgement for external events */
export interface OutboxRepository {
  enqueue(message: OutboxMessage): Promise<void>;
  pending(limit: number): Promise<readonly OutboxMessage[]>;
  markSent(id: string, sentAt: string): Promise<void>;
}
