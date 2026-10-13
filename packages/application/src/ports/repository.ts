import type {
  AnalysisInput,
  AnalysisOutput,
  ActionResolution,
  ActionState,
  ProposalState,
  ModelInvocation,
  ModelFailureAudit,
  ModelSelection,
  RecordDetail,
  RecordFields,
  RecordPatch,
  CollectionQuery,
  RecordSummary,
  CursorPage,
  MediaAsset,
  MediaCompletion,
  UploadRequest,
  UploadSession,
  KnowledgeDetail,
  KnowledgeSummary,
  KnowledgeQuery,
  Location,
  TaskPage,
  TaskQuery,
} from '@antica/contracts';
import type {
  CanonicalView,
  EvidenceAnchor,
  FrameLocator,
  InspectionMethod,
  InspectionMethodVersion,
  KnowledgeEntry,
  Observation,
  RecordCheck,
  RecordVersions,
  Region,
} from '@antica/domain';

import type { OperationResult } from './result.js';
import type { RetrievalSnapshot } from './retrieval.js';
import type {
  CommandRepository,
  JobRepository,
  OutboxRepository,
  ResearchRepository,
  SourceRepository,
} from './storage.js';
import type {
  ComparisonRepository,
  EditDraftRepository,
  TranscriptionRepository,
} from './workflows.js';

/** groups owner-scoped repositories in one database transaction */
export interface UnitOfWork {
  readonly records: RecordRepository;
  readonly locations: LocationRepository;
  readonly media: MediaRepository;
  readonly evidence: EvidenceRepository;
  readonly analyses: AnalysisRepository;
  readonly knowledge: KnowledgeRepository;
  readonly sources: SourceRepository;
  readonly research: ResearchRepository;
  readonly jobs: JobRepository;
  readonly commands: CommandRepository;
  readonly outbox: OutboxRepository;
  readonly transcriptions: TranscriptionRepository;
  readonly editDrafts: EditDraftRepository;
  readonly comparisons: ComparisonRepository;
}
export interface TransactionPort {
  /** scopes all repositories to the authenticated collector and rolls back failed results */
  run<T extends OperationResult<unknown>>(
    ownerId: string,
    operation: (unit: UnitOfWork) => Promise<T>,
  ): Promise<T>;
}

/** a component cannot be removed while other records still reference it */
export class ComponentInUseError extends Error {
  constructor() {
    super('Component is still referenced');
    this.name = 'ComponentInUseError';
  }
}

export interface RecordRepository {
  allocateCode(): Promise<string>;
  get(id: string): Promise<RecordDetail | null>;
  query(query: CollectionQuery): Promise<CursorPage<RecordSummary>>;
  getThumbnailTargets(recordIds: readonly string[]): Promise<
    ReadonlyArray<{
      readonly recordId: string;
      readonly assetOrDerivativeId: string;
      readonly storageKey: string;
    }>
  >;
  create(record: RecordDetail): Promise<void>;
  patch(
    id: string,
    patch: RecordPatch,
    versions: RecordVersions,
  ): Promise<RecordDetail | null>;
  bumpVersions(
    id: string,
    expectedRevision: number,
    changes: { readonly analysisInput: boolean; readonly evidence: boolean },
  ): Promise<RecordVersions | null>;
}
export interface LocationRepository {
  query(): Promise<
    ReadonlyArray<{ readonly id: string; readonly label: string }>
  >;
  findByLabel(
    label: string,
  ): Promise<{ readonly id: string; readonly label: string } | null>;
  create(location: {
    readonly id: string;
    readonly label: string;
  }): Promise<Location>;
}
export interface MediaRepository {
  get(id: string): Promise<MediaAsset | null>;
  getCanonicalViewSource(viewId: string): Promise<{
    readonly originalAssetId: string;
    readonly derivativeId: string | null;
    readonly storageKey: string;
    readonly mimeType: string;
  } | null>;
  createUpload(request: UploadRequest, session: UploadSession): Promise<void>;
  getUploadByRequestKey(
    ownerId: string,
    requestKey: string,
  ): Promise<UploadSession | null>;
  getUploadSession(assetId: string): Promise<UploadSession | null>;
  complete(id: string, completion: MediaCompletion): Promise<void>;
  addDerivative(derivative: MediaDerivative): Promise<void>;
  getDerivative(id: string): Promise<MediaDerivative | null>;
  getFrameByDerivative(id: string): Promise<FrameLocator | null>;
  addCanonicalView(view: CanonicalView): Promise<void>;
  getCanonicalView(id: string): Promise<CanonicalView | null>;
  markReadyOnce(
    assetId: string,
    expectedState: 'uploaded' | 'processing',
  ): Promise<boolean>;
}
export interface MediaDerivative {
  readonly id: string;
  readonly originalAssetId: string;
  readonly parentDerivativeId: string | null;
  readonly kind: 'canonical' | 'thumbnail' | 'crop' | 'frame' | 'preview';
  readonly storageKey: string;
  readonly mimeType: string;
  readonly byteLength: number;
  readonly sha256: string;
  readonly region: Region | null;
  readonly transformToOriginal: CanonicalView['transformToOriginal'];
  readonly frame?: FrameLocator;
}
export interface EvidenceRepository {
  getAnchor(id: string): Promise<EvidenceAnchor | null>;
  queryAnchorsByAsset(
    originalAssetId: string,
  ): Promise<readonly EvidenceAnchor[]>;
  addAnchor(anchor: EvidenceAnchor): Promise<void>;
  getObservation(id: string): Promise<Observation | null>;
  addObservation(observation: Observation): Promise<void>;
  supersedeObservation(id: string, replacementId: string): Promise<void>;
  queryObservations(
    recordId: string,
    cursor?: string,
    limit?: number,
  ): Promise<CursorPage<Observation>>;
  getCheck(id: string): Promise<RecordCheck | null>;
  findActiveCheck(
    recordId: string,
    methodVersionId: string,
    componentIds: readonly string[],
  ): Promise<RecordCheck | null>;
  addCheck(check: RecordCheck): Promise<void>;
  updateCheck(check: RecordCheck, expectedRevision: number): Promise<boolean>;
}
export interface AnalysisRunRecord {
  readonly id: string;
  readonly jobId: string;
  readonly recordId: string;
  readonly requestedSnapshot: RequestedAnalysisSnapshot;
  readonly modelSelection: ModelSelection;
  readonly input: AnalysisInput | null;
  readonly retrievalSnapshot: RetrievalSnapshot | null;
  readonly output: AnalysisOutput | null;
  readonly invocation: ModelInvocation | null;
  readonly failureAudits: ReadonlyArray<ModelFailureAudit>;
  readonly suggestedMethodVersions: ReadonlyArray<{
    readonly methodId: string;
    readonly methodVersionId: string;
    readonly owningEntryId: string;
    readonly titleZhHant: string;
  }>;
  readonly status: 'queued' | 'running' | 'completed' | 'partial' | 'failed';
}
export interface RequestedAnalysisSnapshot {
  readonly id: string;
  readonly recordId: string;
  readonly recordRevision: number;
  readonly analysisInputVersion: number;
  readonly evidenceVersion: number;
  readonly assetIds: readonly string[];
  readonly evidenceIds: readonly string[];
  readonly observationIds: readonly string[];
  readonly checkIds: readonly string[];
  /** freezes selected metadata in PostgreSQL while original media bytes remain in private S3 */
  readonly frozenPack: {
    readonly recordFields: RecordFields;
    readonly media: readonly MediaAsset[];
    readonly evidence: readonly EvidenceAnchor[];
    readonly observations: readonly Observation[];
    readonly checks: readonly RecordCheck[];
  };
  readonly createdAt: string;
}
export interface AnalysisRepository {
  get(id: string): Promise<AnalysisRunRecord | null>;
  getBySnapshotId(snapshotId: string): Promise<AnalysisRunRecord | null>;
  create(run: AnalysisRunRecord): Promise<void>;
  setStatus(
    id: string,
    expectedStatuses: readonly AnalysisRunRecord['status'][],
    status: AnalysisRunRecord['status'],
  ): Promise<boolean>;
  appendFailureAudit(id: string, audit: ModelFailureAudit): Promise<boolean>;
  /** binds finalized input and retrieval snapshot once */
  bindRetrievalSnapshot(
    runId: string,
    input: AnalysisInput,
    snapshot: RetrievalSnapshot,
  ): Promise<boolean>;
  queryTasks(query: TaskQuery): Promise<TaskPage>;
  saveOutput(
    id: string,
    output: AnalysisOutput,
    suggestedMethodVersions: AnalysisRunRecord['suggestedMethodVersions'],
    invocation: ModelInvocation,
    status: 'completed' | 'partial',
  ): Promise<void>;
  getActionState(runId: string, actionId: string): Promise<ActionState | null>;
  updateActionState(
    state: ActionState,
    expectedRevision: number,
    resolution: ActionResolution,
  ): Promise<boolean>;
  getProposalStates(runId: string): Promise<readonly ProposalState[]>;
  appendAdoption(
    runId: string,
    proposalId: string,
    status: 'accepted' | 'skipped',
    eventId: string,
  ): Promise<void>;
}
export interface KnowledgeRepository {
  allocateCode(): Promise<string>;
  get(
    id: string,
    revision?: number,
    methodVersionId?: string,
  ): Promise<KnowledgeDetail | null>;
  query(query: KnowledgeQuery): Promise<CursorPage<KnowledgeSummary>>;
  create(entry: KnowledgeEntry): Promise<void>;
  addRevision(
    entry: KnowledgeEntry,
    expectedRevision: number,
  ): Promise<boolean>;
  getMethod(id: string): Promise<InspectionMethod | null>;
  getMethodVersion(id: string): Promise<InspectionMethodVersion | null>;
  createMethod(
    method: InspectionMethod,
    version: InspectionMethodVersion,
  ): Promise<void>;
  linkMethods(
    entryId: string,
    revision: number,
    methodVersionIds: readonly string[],
  ): Promise<void>;
  addMethodVersion(
    methodId: string,
    expectedVersionId: string,
    version: InspectionMethodVersion,
  ): Promise<boolean>;
}
export * from './storage.js';
