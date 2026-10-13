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
/** Actual stored original or derivative available from a selected source version. */
export interface SourceReadTarget {
  readonly assetOrDerivativeId: string;
  readonly storageKey: string;
}
export interface SourceRegistrationAsset {
  readonly assetId: string;
  readonly order: number;
  readonly printedPageLabel: string | null;
  readonly presentation?: NonNullable<SourcePage['presentation']>;
}
export interface ProviderChunkMapping {
  readonly provider: string;
  readonly providerChunkId: string;
  readonly providerFigureId: string | null;
  readonly parseRunId: string;
  readonly indexVersion: string;
  readonly sourceVersionId: string;
  readonly canonicalRegionIds: readonly string[];
}
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
export interface JobRepository {
  get(id: string): Promise<JobEnvelope | null>;
  getByResource(kind: JobKind, resourceId: string): Promise<JobEnvelope | null>;
  /** Retries a failed job with CAS while preserving completed terminal states. */
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
export interface JobStep {
  readonly jobId: string;
  readonly step: string;
  readonly revision: number;
  readonly state: 'ready' | 'leased' | 'waiting' | 'completed' | 'failed';
  readonly leaseUntil: string | null;
  readonly checkpoint: unknown;
  readonly result: unknown;
}
export interface CommandReceipt<T = unknown> {
  readonly ownerId: string;
  readonly operation: string;
  readonly requestKey: string;
  readonly fingerprint: string;
  readonly status: number;
  readonly result: T;
}
export interface CommandRepository {
  get(
    ownerId: string,
    operation: string,
    requestKey: string,
  ): Promise<CommandReceipt | null>;
  insert(receipt: CommandReceipt): Promise<void>;
}
export interface OutboxMessage {
  readonly id: string;
  readonly name: string;
  readonly event: JobEvent;
  readonly createdAt: string;
  readonly sentAt: string | null;
}
export interface OutboxRepository {
  enqueue(message: OutboxMessage): Promise<void>;
  pending(limit: number): Promise<readonly OutboxMessage[]>;
  markSent(id: string, sentAt: string): Promise<void>;
}
