import { failure } from './failure.js';

import type { SourceAccepted, SourceCommand } from '@antica/contracts';
import type { SourceVersion } from '@antica/domain';

import type {
  ClockPort,
  IdPort,
  OperationResult,
  UnitOfWork,
} from '../../ports/index.js';

/** inputs for a selected-page reprocessing command in the submit transaction */
export interface ReprocessParams {
  readonly unit: UnitOfWork;
  readonly ownerId: string;
  readonly command: Extract<SourceCommand, { readonly mode: 'reprocess' }>;
  readonly insertReceipt: (accepted: SourceAccepted) => Promise<void>;
  readonly clock: ClockPort;
  readonly ids: IdPort;
}

/**
 * validates selected pages and queues a reprocess job in the existing transaction
 * @param params authenticated command and receipt state from submission
 * @returns accepted job identity or a source/page validation failure
 */
export async function submitReprocess(
  params: ReprocessParams,
): Promise<OperationResult<SourceAccepted>> {
  const { unit, command } = params;
  const version = await unit.sources.getVersion(command.sourceVersionId);
  if (!version) {
    return failure('NOT_FOUND', 'Source version not found');
  }
  const source = await unit.sources.get(version.sourceId, version.id);
  if (!source) {
    return failure('NOT_FOUND', 'Source not found');
  }
  if (
    command.pageIds.length === 0 ||
    new Set(command.pageIds).size !== command.pageIds.length
  ) {
    return failure('VALIDATION_FAILED', 'Select distinct pages to reprocess');
  }
  for (const pageId of command.pageIds) {
    const page = await unit.sources.getPage(pageId);
    if (page?.sourceVersionId !== version.id) {
      return failure(
        'SOURCE_UNAVAILABLE',
        'Selected page does not belong to the source version',
      );
    }
  }

  return queueReprocess(params, version);
}

/**
 * persists the selected-page job, outbox event and receipt in submission's transaction
 * @param params authenticated command, clock and ID generator
 * @param version validated source version for the selected pages
 * @returns accepted job identity
 */
async function queueReprocess(
  params: ReprocessParams,
  version: SourceVersion,
): Promise<OperationResult<SourceAccepted>> {
  const { unit, ownerId, command, clock, ids } = params;
  const jobId = ids.create();
  const now = clock.now();
  const accepted = {
    sourceId: version.sourceId,
    sourceVersionId: version.id,
    jobId,
  };
  await unit.jobs.create({
    id: jobId,
    kind: 'sourceIngestion',
    resourceId: version.id,
    state: { kind: 'queued' },
    createdAt: now,
    updatedAt: now,
    result: { pageIds: command.pageIds },
  });
  await unit.outbox.enqueue({
    id: ids.create(),
    name: 'sourceIngestion',
    event: {
      eventId: ids.create(),
      schemaVersion: '1',
      jobId,
      resourceId: version.id,
      ownerId,
      idempotencyKey: command.requestKey,
    },
    createdAt: now,
    sentAt: null,
  });
  await params.insertReceipt(accepted);

  return { success: true, data: accepted };
}
