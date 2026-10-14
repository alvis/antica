import { createGetOperation } from './ingestion/detail.js';
import { createSubmitOperation } from './ingestion/submission.js';
import { createSourceIngestionHandler } from './ingestion/worker.js';

import type {
  SourceAccepted,
  SourceCommand,
  SourceDetail,
} from '@antica/contracts';

import type {
  ClockPort,
  DurableSourceParsingPort,
  DurableTextIndexWriterPort,
  IdPort,
  IndexIdentity,
  OperationResult,
  ParsedSourcePack,
  SourceParsingPort,
  TextIndexWriterPort,
  TransactionPort,
} from '../ports/index.js';

export { createSourceIngestionHandler };

/** owner-selected source detail and page cursor */
export interface SourceGetParams {
  readonly ownerId: string;
  readonly id: string;
  readonly versionId?: string;
  readonly pageId?: string;
  readonly cursor?: string;
  readonly limit?: number;
}

/** source commands and reads within the authenticated collector boundary */
export interface SourceService {
  submit(
    ownerId: string,
    command: SourceCommand,
  ): Promise<OperationResult<SourceAccepted>>;
  get(params: SourceGetParams): Promise<OperationResult<SourceDetail>>;
}

/** owner-checked signing of source media after its version is resolved */
export interface SourceReadSigningPort {
  signRead(
    storageKey: string,
  ): Promise<{ readonly url: string; readonly expiresAt: string }>;
}

/** indexes parsed reference images after their canonical database rows commit */
export interface SourceImageIndexPort {
  index(
    ownerId: string,
    pack: ParsedSourcePack,
  ): Promise<OperationResult<{ readonly indexedCount: number }>>;
}

/** selects honest readiness for local or externally persisted retrieval indexes */
export interface SourceIndexingParams {
  readonly text:
    | { readonly kind: 'local' }
    | {
        readonly kind: 'external';
        readonly index: IndexIdentity;
        readonly writer: TextIndexWriterPort | DurableTextIndexWriterPort;
      };
  readonly image:
    | { readonly kind: 'local' }
    | { readonly kind: 'external'; readonly writer: SourceImageIndexPort };
}

/** dependencies for authenticated source submission and detail reads */
export interface CreateSourceServiceParams {
  readonly transaction: TransactionPort;
  readonly clock: ClockPort;
  readonly ids: IdPort;
  readonly signer?: SourceReadSigningPort;
}

/** dependencies for the resumable source ingestion worker */
export interface SourceIngestionHandlerParams {
  readonly transaction: TransactionPort;
  readonly parser: SourceParsingPort | DurableSourceParsingPort;
  readonly clock: ClockPort;
  readonly ids: IdPort;
  readonly indexing?: SourceIndexingParams;
}

/**
 * creates persistent source intake operations
 * @param params collector transaction, allocation ports and optional detail signer
 * @returns source submission and detail operations bound to the collector
 */
export function createSourceService(
  params: CreateSourceServiceParams,
): SourceService {
  return {
    submit: createSubmitOperation(params),
    get: createGetOperation({
      transaction: params.transaction,
      signer: params.signer,
    }),
  };
}
