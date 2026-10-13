import type {
  EditDraftDetail,
  EditDraftResult,
  ImageCompareRequest,
  ImageComparisonResult,
  ModelInvocation,
  ModelSelection,
  PublicError,
  TranscriptionDetail,
  TranscriptionResult,
  TranscriptionSubmit,
  EditDraftRequest,
} from '@antica/contracts';

import type { ModelFailureAudit } from './model.js';

export interface TranscriptionRunRecord {
  readonly detail: TranscriptionDetail;
  readonly request: TranscriptionSubmit;
  readonly modelSelection: ModelSelection;
}

/** The original provider text/result is written once; confirmation only records adoption. */
export interface TranscriptionRepository {
  get(id: string): Promise<TranscriptionRunRecord | null>;
  create(run: TranscriptionRunRecord): Promise<void>;
  saveResult(
    id: string,
    result: TranscriptionResult,
    invocation: ModelInvocation,
    expectedRevision: number,
    updatedAt: string,
  ): Promise<boolean>;
  confirm(
    id: string,
    expectedRevision: number,
    observationId: string,
    updatedAt: string,
  ): Promise<TranscriptionDetail | null>;
}

export interface EditDraftRunRecord {
  readonly detail: EditDraftDetail;
  readonly request: EditDraftRequest;
  readonly modelSelection: ModelSelection;
}

/** The pinned input and generated result are immutable; proposal adoption uses CAS. */
export interface EditDraftRepository {
  get(id: string): Promise<EditDraftRunRecord | null>;
  create(run: EditDraftRunRecord): Promise<void>;
  saveResult(
    id: string,
    result: EditDraftResult,
    invocation: ModelInvocation,
    expectedRevision: number,
    updatedAt: string,
  ): Promise<boolean>;
  markApplied(
    id: string,
    expectedRevision: number,
    selectedProposalIds: readonly string[],
    updatedAt: string,
  ): Promise<EditDraftDetail | null>;
}

export interface ComparisonFailureRecord {
  readonly id: string;
  readonly query: ImageCompareRequest;
  readonly error: Omit<PublicError, 'requestId'>;
  readonly audit: ModelFailureAudit;
  readonly createdAt: string;
}

/** Retains the actual comparison invocation and failed generated output for audit. */
export interface ComparisonRepository {
  get(id: string): Promise<ImageComparisonResult | null>;
  save(result: ImageComparisonResult): Promise<void>;
  recordFailure(failure: ComparisonFailureRecord): Promise<void>;
}
