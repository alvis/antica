import type {
  ImageComparison,
  ImageCompareRequest,
  ImageSearchRequest,
  ImageSearchResult,
  ModelInvocation,
  KnowledgeQuery,
  KnowledgeSummary,
  CursorPage,
  RetrievedMethod,
} from '@antica/contracts';
import type { SourceCitation } from '@antica/domain';

import type { ModelOperationResult } from './model.js';
import type { ProviderChunkMapping } from './repository.js';
import type { OperationResult } from './result.js';

export interface IndexIdentity {
  readonly embeddingModelId: string;
  readonly dimensions: number;
  readonly indexVersion: string;
}
export interface RetrievedText {
  readonly citationId: string;
  readonly contentAsRetrieved: string;
  readonly sourceRegionId: string | null;
}
export type { RetrievedMethod } from '@antica/contracts';
export interface RetrievalSnapshot {
  readonly id: string;
  readonly index: IndexIdentity;
  readonly citations: readonly SourceCitation[];
  readonly text: readonly RetrievedText[];
  readonly methods: readonly RetrievedMethod[];
  readonly createdAt: string;
}
export interface TextRetrievalPort {
  search(
    query: KnowledgeQuery,
    index: IndexIdentity,
  ): Promise<OperationResult<CursorPage<KnowledgeSummary>>>;
  snapshot(
    query: string,
    index: IndexIdentity,
  ): Promise<OperationResult<RetrievalSnapshot>>;
}
export interface CanonicalTextChunk {
  readonly sourceVersionId: string;
  readonly parseRunId: string;
  readonly citationId: string;
  readonly canonicalRegionIds: readonly string[];
  readonly contentAsRetrieved: string;
}
export interface TextIndexWriterPort {
  indexSource(input: {
    readonly index: IndexIdentity;
    readonly sourceVersionId: string;
    readonly chunks: readonly CanonicalTextChunk[];
  }): Promise<
    OperationResult<{
      readonly mappings: readonly ProviderChunkMapping[];
      readonly indexedCount: number;
    }>
  >;
}
export interface TextIndexHandle {
  readonly sourceVersionId: string;
  readonly parseRunId: string;
  readonly index: IndexIdentity;
  readonly provider: string;
  readonly providerJobId: string | null;
  readonly providerDocumentIds: readonly string[];
  /** immutable local progress artifact for resumable multi-chunk indexing */
  readonly checkpointAssetId: string;
}
export type TextIndexProgress =
  | ({
      readonly kind: 'waiting';
      readonly resumeAfter?: string;
    } & TextIndexHandle)
  | {
      readonly kind: 'completed';
      readonly mappings: readonly ProviderChunkMapping[];
      readonly indexedCount: number;
    };
export interface DurableTextIndexWriterPort {
  submit(input: {
    readonly index: IndexIdentity;
    readonly sourceVersionId: string;
    readonly parseRunId: string;
    readonly chunks: readonly CanonicalTextChunk[];
  }): Promise<OperationResult<TextIndexProgress>>;
  resume(handle: TextIndexHandle): Promise<OperationResult<TextIndexProgress>>;
}
export interface ImageRetrievalPort {
  search(
    query: ImageSearchRequest,
    index: IndexIdentity,
  ): Promise<OperationResult<ImageSearchResult>>;
  compare(
    query: ImageCompareRequest,
    index: IndexIdentity,
  ): Promise<ModelOperationResult<ImageComparison, ModelInvocation | null>>;
}
export interface PublicWebResearchPort {
  search(
    instructionZhHant: string,
  ): Promise<OperationResult<readonly SourceCitation[]>>;
}
