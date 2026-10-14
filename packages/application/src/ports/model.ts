import type {
  AnalysisInput,
  AnalysisOutput,
  EditDraftRequest,
  EditDraftResult,
  ModelCapabilities,
  ModelInvocation,
  ModelFailureAudit,
  ModelSelection,
  PublicError,
  RecordFields,
  ResearchDraft,
  ResearchRequest,
  TranscriptionRequest,
  TranscriptionResult,
} from '@antica/contracts';
import type { SourceCitation, RecordVersions } from '@antica/domain';

import type { OperationResult } from './result.js';
import type { RetrievedMethod, RetrievedText } from './retrieval.js';

export type { ModelInvocation, ModelFailureAudit } from '@antica/contracts';

/** generated value paired with the invocation that produced it */
export interface ModelResult<
  T,
  TInvocation extends ModelInvocation | null = ModelInvocation,
> {
  readonly value: T;
  /** null only when the provider did not make an invocation */
  readonly invocation: TInvocation;
}
/** model outcome that retains the failed invocation for audit */
export type ModelOperationResult<
  T,
  TInvocation extends ModelInvocation | null = ModelInvocation,
> =
  | { readonly success: true; readonly data: ModelResult<T, TInvocation> }
  | {
      readonly success: false;
      readonly error: Omit<PublicError, 'requestId'>;
      /** underlying provider or validation failure retained outside the public error */
      readonly cause?: unknown;
      /** failed invocation and generated output available for durable audit */
      readonly audit: ModelFailureAudit;
    };
/** frozen analysis inputs and resolved evidence supplied to the model */
export interface AnalysisEvidencePack {
  readonly input: AnalysisInput;
  readonly recordFields: RecordFields;
  /** selected observations, checks, and source excerpts as retrieved */
  readonly text: ReadonlyArray<
    | {
        readonly id: string;
        readonly kind: 'observation' | 'check';
        readonly content: string;
      }
    | {
        readonly kind: 'source';
        readonly citationId: string;
        readonly contentAsRetrieved: string;
        readonly sourceRegionId: string | null;
      }
  >;
  /** persisted evidence image bytes selected from the frozen snapshot */
  readonly images: ReadonlyArray<{
    readonly evidenceId: string;
    readonly mediaType: string;
    readonly bytes: Uint8Array;
  }>;
  readonly citations: readonly SourceCitation[];
  readonly methods: readonly RetrievedMethod[];
}
/** model capability for analysis of a frozen evidence pack */
export interface AnalysisModelPort {
  /**
   * analyzes frozen evidence with the selected model
   * @param pack frozen and resolved analysis evidence
   * @param selection requested model and configuration
   * @returns validated output with invocation or auditable failure
   */
  analyze(
    pack: AnalysisEvidencePack,
    selection: ModelSelection,
  ): Promise<ModelOperationResult<AnalysisOutput>>;
}
/** model capability for drafting research from resolved sources */
export interface ResearchModelPort {
  /**
   * drafts research from the selected source material
   * @param request frozen research request
   * @param sources resolved citations and retrieved text
   * @param selection requested model and configuration
   * @returns draft with invocation or auditable failure
   */
  draft(
    request: ResearchRequest,
    sources: {
      readonly citations: readonly SourceCitation[];
      readonly text: readonly RetrievedText[];
    },
    selection: ModelSelection,
  ): Promise<ModelOperationResult<ResearchDraft>>;
}
/** model capability for drafting changes from frozen record context */
export interface RecordEditingPort {
  /**
   * drafts record changes from frozen source text and record versions
   * @param request frozen edit request
   * @param sourceText selected source excerpts
   * @param context record fields and versions used for the draft
   * @param selection requested model and configuration
   * @returns draft with invocation or auditable failure
   */
  draft(
    request: EditDraftRequest,
    sourceText: readonly string[],
    context: {
      readonly fields: RecordFields;
      readonly versions: RecordVersions;
    },
    selection: ModelSelection,
  ): Promise<ModelOperationResult<EditDraftResult>>;
}
/** model capability for transcribing persisted audio bytes */
export interface TranscriptionPort {
  /**
   * transcribes the persisted audio selected by the request
   * @param request frozen transcription request
   * @param audio media type and stored audio bytes
   * @param selection requested model and configuration
   * @returns transcription with invocation or auditable failure
   */
  transcribe(
    request: TranscriptionRequest,
    audio: { readonly mimeType: string; readonly bytes: Uint8Array },
    selection: ModelSelection,
  ): Promise<ModelOperationResult<TranscriptionResult>>;
}
/** selected model resolution against required command capabilities */
export interface ModelCatalogPort {
  /**
   * resolves a selected model with the required capabilities
   * @param selection requested model and configuration
   * @param required capabilities the command needs
   * @returns effective model identity and capabilities or a public error
   */
  resolve(
    selection: ModelSelection,
    required: Partial<ModelCapabilities>,
  ): Promise<
    OperationResult<{
      readonly effectiveModelId: string;
      readonly capabilities: ModelCapabilities;
    }>
  >;
}
