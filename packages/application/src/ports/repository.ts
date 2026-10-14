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

/** owner-scoped repositories participating in one database transaction */
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
/** authenticated owner-scoped transaction boundary */
export interface TransactionPort {
  /**
   * scopes all repositories to the authenticated collector and rolls back failed results
   * @param ownerId authenticated collector identifier
   * @param operation work to perform in one transaction
   * @returns operation outcome
   */
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

/** record persistence and version counter operations */
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
  /**
   * advances the selected input and evidence versions only at the expected revision
   * @param id record identifier
   * @param expectedRevision revision required for the update
   * @param changes version counters selected for advancement
   * @returns updated versions or null when the revision changed
   */
  bumpVersions(
    id: string,
    expectedRevision: number,
    changes: { readonly analysisInput: boolean; readonly evidence: boolean },
  ): Promise<RecordVersions | null>;
}
/** collector location label lookup and persistence */
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
/** media upload, derivative, and canonical view persistence */
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
  /**
   * moves an uploaded or processing asset to ready at most once
   * @param assetId original asset identifier
   * @param expectedState state required for the transition
   * @returns whether the transition occurred
   */
  markReadyOnce(
    assetId: string,
    expectedState: 'uploaded' | 'processing',
  ): Promise<boolean>;
}
/** persisted derivative with provenance and a transform back to its original */
export interface MediaDerivative {
  readonly id: string;
  readonly originalAssetId: string;
  /** derivative this was generated from, when processing was chained */
  readonly parentDerivativeId: string | null;
  readonly kind: 'canonical' | 'thumbnail' | 'crop' | 'frame' | 'preview';
  readonly storageKey: string;
  readonly mimeType: string;
  readonly byteLength: number;
  readonly sha256: string;
  readonly region: Region | null;
  /** maps this derivative's canonical coordinates to the original asset */
  readonly transformToOriginal: CanonicalView['transformToOriginal'];
  readonly frame?: FrameLocator;
}
/** evidence anchor, observation, and inspection check persistence */
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
  /**
   * resolves a check by method version and duplicate-free component scope
   * @param recordId record that owns the check
   * @param methodVersionId inspection method version
   * @param componentIds selected component scope
   * @returns matching active check, when present
   */
  findActiveCheck(
    recordId: string,
    methodVersionId: string,
    componentIds: readonly string[],
  ): Promise<RecordCheck | null>;
  addCheck(check: RecordCheck): Promise<void>;
  updateCheck(check: RecordCheck, expectedRevision: number): Promise<boolean>;
}
/** durable analysis state bound to the requested frozen snapshot */
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
  /** failed model invocations retained independently of accepted output */
  readonly failureAudits: ReadonlyArray<ModelFailureAudit>;
  readonly suggestedMethodVersions: ReadonlyArray<{
    readonly methodId: string;
    readonly methodVersionId: string;
    readonly owningEntryId: string;
    readonly titleZhHant: string;
  }>;
  /** current durable lifecycle state of this analysis run */
  readonly status: 'queued' | 'running' | 'completed' | 'partial' | 'failed';
}
/** requested evidence and record versions captured before model execution */
export interface RequestedAnalysisSnapshot {
  readonly id: string;
  readonly recordId: string;
  readonly recordRevision: number;
  /** record input version used to detect stale analysis */
  readonly analysisInputVersion: number;
  /** evidence version used to detect stale analysis */
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
/** analysis run, failure audit, and collector adoption persistence */
export interface AnalysisRepository {
  get(id: string): Promise<AnalysisRunRecord | null>;
  getBySnapshotId(snapshotId: string): Promise<AnalysisRunRecord | null>;
  create(run: AnalysisRunRecord): Promise<void>;
  /**
   * changes run status only from one of the expected current states
   * @param id analysis run identifier
   * @param expectedStatuses allowed current states
   * @param status replacement state
   * @returns whether the transition occurred
   */
  setStatus(
    id: string,
    expectedStatuses: readonly AnalysisRunRecord['status'][],
    status: AnalysisRunRecord['status'],
  ): Promise<boolean>;
  appendFailureAudit(id: string, audit: ModelFailureAudit): Promise<boolean>;
  /**
   * binds finalized input and retrieval snapshot once
   * @param runId analysis run identifier
   * @param input finalized model input
   * @param snapshot retrieval evidence used by the model
   * @returns whether the snapshot was bound
   */
  bindRetrievalSnapshot(
    runId: string,
    input: AnalysisInput,
    snapshot: RetrievalSnapshot,
  ): Promise<boolean>;
  queryTasks(query: TaskQuery): Promise<TaskPage>;
  /**
   * records generated output, invocation, and final completion state
   * @param id analysis run identifier
   * @param output validated generated output
   * @param suggestedMethodVersions methods suggested by the result
   * @param invocation model call that produced the output
   * @param status final completion state
   */
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
/** knowledge revision and versioned inspection method persistence */
export interface KnowledgeRepository {
  allocateCode(): Promise<string>;
  get(
    id: string,
    revision?: number,
    methodVersionId?: string,
  ): Promise<KnowledgeDetail | null>;
  query(query: KnowledgeQuery): Promise<CursorPage<KnowledgeSummary>>;
  create(entry: KnowledgeEntry): Promise<void>;
  /**
   * adds a revision only when the existing revision matches
   * @param entry replacement knowledge revision
   * @param expectedRevision current revision required for the update
   * @returns whether the revision was added
   */
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
  /**
   * adds a method version only from the expected predecessor
   * @param methodId inspection method identifier
   * @param expectedVersionId current version required for the update
   * @param version replacement method version
   * @returns whether the version was added
   */
  addMethodVersion(
    methodId: string,
    expectedVersionId: string,
    version: InspectionMethodVersion,
  ): Promise<boolean>;
}
export * from './storage.js';
