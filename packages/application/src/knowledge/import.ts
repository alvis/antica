import { knowledgeImportRequestSchema } from '@antica/contracts';

import type {
  ErrorCode,
  KnowledgeImportStore,
  KnowledgeProviderRegistry,
  KnowledgeImportRequest,
  KnowledgeImportRun,
} from '@antica/contracts';

import type { OperationResult } from '../ports/index.js';

/** reviewed adapters, durable checkpoints and clock shared by commands and workers */
export interface KnowledgeImportParams {
  readonly store: KnowledgeImportStore;
  readonly registry: KnowledgeProviderRegistry;
  readonly now: () => string;
  readonly random?: () => number;
}

/** operator controls scoped to the authenticated owner */
export interface KnowledgeImportService {
  request(
    ownerId: string,
    input: KnowledgeImportRequest,
  ): Promise<OperationResult<KnowledgeImportRun>>;
  get(
    ownerId: string,
    runId: string,
  ): Promise<OperationResult<KnowledgeImportRun>>;
  resume(
    ownerId: string,
    runId: string,
  ): Promise<OperationResult<KnowledgeImportRun>>;
  cancel(
    ownerId: string,
    runId: string,
  ): Promise<OperationResult<KnowledgeImportRun>>;
}

export { createKnowledgeImportHandler } from './import-handler.js';

/**
 * creates allowlisted operator commands without accepting remote URLs
 * @param params durable store, reviewed adapters and clock
 * @returns owner-scoped import commands
 */
export function createKnowledgeImportService(
  params: KnowledgeImportParams,
): KnowledgeImportService {
  return {
    request: async (ownerId, input) => requestImport(params, ownerId, input),
    get: async (ownerId, runId) =>
      result(await params.store.get(ownerId, runId)),
    resume: async (ownerId, runId) => {
      const run = await params.store.get(ownerId, runId);
      if (!run) {
        return result(null);
      }
      if (
        params.registry.get(run.provider)?.adapterVersion !== run.adapterVersion
      ) {
        return failure(
          'REVISION_CONFLICT',
          'Adapter mismatch requires an explicit restart with a new request key',
        );
      }
      const resumed = await params.store.control(ownerId, runId, 'resume');

      return result(resumed);
    },
    cancel: async (ownerId, runId) => {
      const cancelled = await params.store.control(ownerId, runId, 'cancel');

      return result(cancelled);
    },
  };
}

/**
 * returns an owner-scoped view without revealing another owner
 * @param run matched run or absence
 * @returns public command result
 */
function result(
  run: KnowledgeImportRun | 'restart_required' | null,
): OperationResult<KnowledgeImportRun> {
  if (run === 'restart_required') {
    return failure(
      'REVISION_CONFLICT',
      'Cursor or schema mismatch requires an explicit restart with a new request key',
    );
  }

  return run
    ? { success: true, data: run }
    : failure('NOT_FOUND', 'Import run not found');
}

/**
 * creates an actionable command failure
 * @param code public failure code
 * @param message actionable summary
 * @returns failed command
 */
function failure(code: ErrorCode, message: string): OperationResult<never> {
  return { success: false, error: { code, message, retryable: false } };
}

/**
 * validates the selection before creating its atomic request
 * @param params reviewed registry and persistence
 * @param ownerId authenticated owner
 * @param input bounded provider selection
 * @returns original or newly created import
 */
async function requestImport(
  params: KnowledgeImportParams,
  ownerId: string,
  input: KnowledgeImportRequest,
): Promise<OperationResult<KnowledgeImportRun>> {
  const parsed = knowledgeImportRequestSchema.safeParse(input);
  if (!parsed.success) {
    return failure('VALIDATION_FAILED', 'Invalid bounded import selection');
  }
  const adapter = params.registry.get(parsed.data.selection.provider);
  if (adapter?.provider !== parsed.data.selection.provider) {
    return failure('VALIDATION_FAILED', 'Provider is not reviewed');
  }
  if (Date.parse(parsed.data.selection.deadline) <= Date.parse(params.now())) {
    return failure('VALIDATION_FAILED', 'Import deadline has elapsed');
  }
  const run = await params.store.request(
    ownerId,
    parsed.data,
    adapter.adapterVersion,
  );

  return run === 'conflict'
    ? failure(
        'REVISION_CONFLICT',
        'Request key belongs to a different selection',
      )
    : { success: true, data: run };
}
