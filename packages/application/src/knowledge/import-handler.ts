import { providerCursorSchema } from '@antica/contracts';

import { stopped } from './import-errors.js';
import { fetchImportBatch } from './import-fetch.js';

import type { JobHandlerOutcome } from '../jobs/drain.js';

import type { OperationResult } from '../ports/index.js';

import type { KnowledgeImportParams } from './import.js';

const providerTimeoutMilliseconds = 30_000;

/**
 * creates the ID-only portable one-batch application handler
 * @param params durable store, reviewed adapters and clock
 * @returns bounded batch execution by job ID
 */
export function createKnowledgeImportHandler(
  params: KnowledgeImportParams,
): (jobId: string) => Promise<OperationResult<JobHandlerOutcome>> {
  return async (jobId) => {
    const lease = await params.store.claim(jobId);
    if (!lease) {
      return { success: true, data: { settled: false } };
    }
    const adapter = params.registry.get(lease.run.provider);
    const cursor = lease.checkpoint.providerCursor;
    if (
      adapter?.adapterVersion !== lease.run.adapterVersion ||
      lease.checkpoint.version !== 1 ||
      lease.checkpoint.schemaVersion !== 2 ||
      (cursor &&
        (!providerCursorSchema.safeParse(cursor).success ||
          cursor.queryHash !== lease.run.queryHash ||
          cursor.adapterVersion !== lease.run.adapterVersion))
    ) {
      const settled = await params.store.commit(
        lease,
        stopped(lease.checkpoint, 'RESTART_REQUIRED'),
      );

      return { success: true, data: { settled } };
    }
    const remaining =
      Date.parse(lease.run.selection.deadline) - Date.parse(params.now());
    if (remaining <= 0) {
      const settled = await params.store.commit(
        lease,
        stopped(lease.checkpoint, 'DEADLINE_EXCEEDED'),
      );

      return { success: true, data: { settled } };
    }
    const signal = AbortSignal.timeout(
      Math.min(remaining, providerTimeoutMilliseconds),
    );
    const batch = await fetchImportBatch({ params, lease, adapter, signal });
    const settled = await params.store.commit(lease, batch);

    return { success: true, data: { settled } };
  };
}
