import { describe, expect, it, vi } from 'vitest';

import { createSourceIngestionHandler } from './ingestion.js';

import type { JobEnvelope, SourceDetail } from '@antica/contracts';
import type { SourceVersion } from '@antica/domain';

import type {
  JobRepository,
  OperationResult,
  SourcePageRunSelection,
  SourceParsingPort,
  SourceRepository,
  TextIndexWriterPort,
  TransactionPort,
  UnitOfWork,
} from '../ports/index.js';

import type { SourceImageIndexPort } from './ingestion.js';

interface IngestionState {
  version: SourceVersion;
  job: JobEnvelope;
}

interface IngestionWrites {
  readonly versions: SourceVersion[];
  readonly jobs: JobEnvelope[];
}

interface TransactionFixtureParams {
  readonly current: IngestionState;
  readonly writes: IngestionWrites;
  readonly updateStep: JobRepository['updateStep'];
}

interface PartialUnitOfWork {
  readonly sources: Pick<
    SourceRepository,
    'get' | 'getVersion' | 'getPageRunSelection' | 'updateVersion'
  >;
  readonly jobs: Pick<
    JobRepository,
    'get' | 'getStep' | 'updateStep' | 'update'
  >;
}

const ownerId = 'collector-1';
const now = '2026-10-13T12:00:00.000Z';
const version: SourceDetail['version'] = {
  id: 'version-1',
  sourceId: 'source-1',
  originalAssetIds: ['asset-1'],
  sourceHash: 'a'.repeat(64),
  metadataSnapshot: {
    title: 'Two-page reference',
    contributors: [],
    authorStatus: 'unknown',
    editionStatement: null,
    publisher: null,
    publicationDateAsPrinted: null,
    isbn: null,
    languages: ['en'],
    canonicalUrl: null,
    access: 'stored_copy',
    rightsStatement: null,
    attributionText: null,
  },
  capturedAt: now,
  retrievedAt: null,
  status: 'ready',
  textIndexStatus: 'ready',
  imageIndexStatus: 'ready',
  activeParseRunId: 'previous-parse',
};
const job: JobEnvelope = {
  id: 'selected-parse',
  kind: 'sourceIngestion',
  resourceId: version.id,
  state: { kind: 'queued' },
  result: { pageIds: ['page-a'] },
  createdAt: now,
  updatedAt: now,
};
const selection: readonly SourcePageRunSelection[] = [
  { pageId: 'page-a', parseRunId: 'previous-parse' },
  { pageId: 'page-b', parseRunId: 'previous-parse' },
];
const source: SourceDetail = {
  source: {
    id: version.sourceId,
    revision: 1,
    kind: 'book_pdf',
    metadata: version.metadataSnapshot,
    currentVersionId: version.id,
    createdAt: now,
    updatedAt: now,
  },
  version,
  pages: { items: [], nextCursor: null },
  regions: [],
  referenceImages: [],
  reads: [],
  processingJobId: job.id,
  knowledgeDraftIds: [],
};

describe('fn:createSourceIngestionHandler', () => {
  it('should reject a lost base checkpoint insert before activating a selected-page parse', async () => {
    const current: IngestionState = { version, job };
    const writes: IngestionWrites = { versions: [], jobs: [] };
    const updateStep = vi.fn<JobRepository['updateStep']>(async () => false);
    const parse = vi.fn<SourceParsingPort['parse']>(async () => ({
      success: false,
      error: {
        code: 'JOB_FAILED',
        message: 'Parser unavailable',
        retryable: true,
      },
    }));
    const indexSource = vi.fn<TextIndexWriterPort['indexSource']>(async () => ({
      success: true,
      data: { indexedCount: 0, mappings: [] },
    }));
    const index = vi.fn<SourceImageIndexPort['index']>(async () => ({
      success: true,
      data: { indexedCount: 0 },
    }));
    const handle = createSourceIngestionHandler({
      transaction: createTransaction({ current, writes, updateStep }),
      parser: { parse },
      clock: { now: () => now },
      ids: { create: () => 'failure-request' },
      indexing: {
        text: {
          kind: 'external',
          index: {
            embeddingModelId: 'test',
            dimensions: 1,
            indexVersion: 'v1',
          },
          writer: { indexSource },
        },
        image: { kind: 'external', writer: { index } },
      },
    });

    const result = await handle(ownerId, job.id);

    expect(result).toMatchObject({
      success: false,
      error: { code: 'REVISION_CONFLICT', retryable: true },
    });
    expect(updateStep).toHaveBeenCalledExactlyOnceWith(
      {
        jobId: job.id,
        step: 'parse:base',
        revision: 1,
        state: 'completed',
        leaseUntil: null,
        checkpoint: null,
        result: {
          pages: selection,
          textIndexStatus: 'ready',
          imageIndexStatus: 'ready',
        },
      },
      0,
    );
    expect(updateStep).toHaveResolvedWith(false);
    expect(current).toEqual({ version, job });
    expect(writes).toEqual({ versions: [version], jobs: [] });
    expect(parse).not.toHaveBeenCalled();
    expect(indexSource).not.toHaveBeenCalled();
    expect(index).not.toHaveBeenCalled();
  });
});

/**
 * stages only the repositories exercised before parsing or on parser failure
 * @param params committed state, attempted lifecycle writes, and checkpoint CAS outcome
 * @returns owner-scoped transaction with failed results discarded
 */
function createTransaction(params: TransactionFixtureParams): TransactionPort {
  const { current, writes, updateStep } = params;

  return {
    async run<T extends OperationResult<unknown>>(
      requestedOwnerId: string,
      operation: (unit: UnitOfWork) => Promise<T>,
    ): Promise<T> {
      expect(requestedOwnerId).toBe(ownerId);
      const staged = { ...current };
      const repositories: PartialUnitOfWork = {
        sources: {
          get: async (id, versionId) =>
            id === version.sourceId && versionId === version.id ? source : null,
          getVersion: async (id) => (id === version.id ? staged.version : null),
          getPageRunSelection: async () => selection,
          updateVersion: async (next, expectedStatus, expectedRunId) => {
            writes.versions.push(next);
            if (
              staged.version.status !== expectedStatus ||
              staged.version.activeParseRunId !== expectedRunId
            ) {
              return false;
            }
            staged.version = next;

            return true;
          },
        },
        jobs: {
          get: async (id) => (id === job.id ? staged.job : null),
          getStep: async () => null,
          updateStep,
          update: async (next, expectedUpdatedAt) => {
            writes.jobs.push(next);
            if (staged.job.updatedAt !== expectedUpdatedAt) {
              return false;
            }
            staged.job = next;

            return true;
          },
        },
      } satisfies PartialUnitOfWork;
      // the consumer uses these checked capabilities; unrelated repositories are absent.
      const result = await operation(repositories as UnitOfWork);
      if (result.success) {
        Object.assign(current, staged);
      }

      return result;
    },
  };
}
