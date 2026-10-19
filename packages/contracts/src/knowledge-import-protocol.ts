import type {
  ImportSelection,
  KnowledgeImportRequest,
  MappedObject,
  ProviderCursor,
  ProviderSnapshot,
} from './knowledge-import.js';

/** operational totals; reserved operations protect a disconnected batch */
export interface ImportCounts {
  /** bounded worker SQL plus first request; interrupted reservations are charged conservatively */
  readonly sqlOperations: number;
  /** separately measured operator reads, controls, replay probes and drain scans */
  readonly controlSqlOperations: number;
  readonly reservedOperations: number;
  readonly sqlOperationBudget: number;
  readonly bytes: number;
  readonly processed: number;
  readonly imported: number;
  readonly unchanged: number;
  readonly failed: number;
  readonly batches: readonly number[];
}
/** public owner-scoped run view with bounded failures and per-batch SQL measurements */
export interface KnowledgeImportRun {
  readonly id: string;
  readonly jobId: string;
  readonly ownerId: string;
  readonly provider: string;
  readonly adapterVersion: string;
  readonly queryHash: string;
  readonly selection: ImportSelection;
  readonly status:
    'queued' | 'running' | 'partial' | 'completed' | 'failed' | 'cancelled';
  readonly counts: ImportCounts;
  readonly reason: string | null;
  readonly retryAfter: string | null;
  readonly retryList: readonly ImportRetryItem[];
}
/** failed receipt; terminal attempts remain visible but cannot spin */
export interface ImportRetryItem {
  readonly objectId: string;
  readonly attemptCount: number;
  readonly errorCode: string | null;
}
/** run checkpoint is separate from the provider cursor */
export interface ImportCheckpoint {
  readonly version: number;
  readonly sequence: number;
  readonly schemaVersion: number;
  readonly manifest: readonly string[];
  readonly offset: number;
  readonly listed: boolean;
  readonly providerCursor?: ProviderCursor;
}
/** short persisted lease never holds a connection during provider work */
export interface ImportBatchLease {
  readonly token: string;
  readonly run: KnowledgeImportRun;
  readonly checkpoint: ImportCheckpoint;
  readonly attempts: readonly ImportRetryItem[];
}
export type ImportObjectResult =
  | {
      readonly kind: 'snapshot';
      readonly objectId: string;
      readonly snapshot: ProviderSnapshot;
      readonly mapped: MappedObject;
      readonly bytes: number;
    }
  | { readonly kind: 'unchanged' | 'missing'; readonly objectId: string }
  | {
      readonly kind: 'failed';
      readonly objectId: string;
      readonly errorCode: string;
      readonly retryable: boolean;
    };
/** fully fetched and validated batch for the short atomic writer */
export interface ImportBatch {
  readonly checkpoint: ImportCheckpoint;
  readonly objects: readonly ImportObjectResult[];
  readonly reason: string | null;
  readonly retryAfter: string | null;
  readonly stop: boolean;
}
/** persistence shared by the drain and future ID-only event delivery */
export interface KnowledgeImportStore {
  request(
    ownerId: string,
    input: KnowledgeImportRequest,
    adapterVersion: string,
  ): Promise<KnowledgeImportRun | 'conflict'>;
  get(ownerId: string, runId: string): Promise<KnowledgeImportRun | null>;
  control(
    ownerId: string,
    runId: string,
    action: 'resume' | 'cancel',
  ): Promise<KnowledgeImportRun | 'restart_required' | null>;
  claim(jobId: string): Promise<ImportBatchLease | null>;
  commit(lease: ImportBatchLease, batch: ImportBatch): Promise<boolean>;
}
