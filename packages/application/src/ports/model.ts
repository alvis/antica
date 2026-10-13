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

export interface ModelResult<
  T,
  TInvocation extends ModelInvocation | null = ModelInvocation,
> {
  readonly value: T;
  readonly invocation: TInvocation;
}
export type ModelOperationResult<
  T,
  TInvocation extends ModelInvocation | null = ModelInvocation,
> =
  | { readonly success: true; readonly data: ModelResult<T, TInvocation> }
  | {
      readonly success: false;
      readonly error: Omit<PublicError, 'requestId'>;
      readonly cause?: unknown;
      readonly audit: ModelFailureAudit;
    };
export interface AnalysisEvidencePack {
  readonly input: AnalysisInput;
  readonly recordFields: RecordFields;
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
  readonly images: ReadonlyArray<{
    readonly evidenceId: string;
    readonly mediaType: string;
    readonly bytes: Uint8Array;
  }>;
  readonly citations: readonly SourceCitation[];
  readonly methods: readonly RetrievedMethod[];
}
export interface AnalysisModelPort {
  analyze(
    pack: AnalysisEvidencePack,
    selection: ModelSelection,
  ): Promise<ModelOperationResult<AnalysisOutput>>;
}
export interface ResearchModelPort {
  draft(
    request: ResearchRequest,
    sources: {
      readonly citations: readonly SourceCitation[];
      readonly text: readonly RetrievedText[];
    },
    selection: ModelSelection,
  ): Promise<ModelOperationResult<ResearchDraft>>;
}
export interface RecordEditingPort {
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
export interface TranscriptionPort {
  transcribe(
    request: TranscriptionRequest,
    audio: { readonly mimeType: string; readonly bytes: Uint8Array },
    selection: ModelSelection,
  ): Promise<ModelOperationResult<TranscriptionResult>>;
}
export interface ModelCatalogPort {
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
