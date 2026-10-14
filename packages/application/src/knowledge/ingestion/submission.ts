import { requestFingerprint } from '../receipt.js';

import { failure } from './failure.js';

import { submitRegistration } from './registration.js';

import { submitReprocess } from './reprocess.js';

import type { SourceAccepted, SourceCommand } from '@antica/contracts';

import type {
  ClockPort,
  IdPort,
  OperationResult,
  TransactionPort,
} from '../../ports/index.js';

import type { SourceService } from '../ingestion.js';

/** inputs shared by both source submission branches */
export interface SourceSubmissionParams {
  readonly transaction: TransactionPort;
  readonly clock: ClockPort;
  readonly ids: IdPort;
}

/**
 * binds source submission to one owner-scoped transaction
 * @param params transaction and allocation ports from the source factory
 * @returns idempotent registration and reprocessing operation
 */
export function createSubmitOperation(
  params: SourceSubmissionParams,
): SourceService['submit'] {
  const { transaction, clock, ids } = params;

  return async (
    ownerId: string,
    command: SourceCommand,
  ): Promise<OperationResult<SourceAccepted>> =>
    transaction.run<OperationResult<SourceAccepted>>(ownerId, async (unit) => {
      const fingerprint = requestFingerprint(command);
      const prior = await unit.commands.get(
        ownerId,
        'sources.submit',
        command.requestKey,
      );
      if (prior) {
        return prior.fingerprint === fingerprint
          ? { success: true, data: prior.result as SourceAccepted }
          : failure(
              'VALIDATION_FAILED',
              'Idempotency key was used for a different source command',
            );
      }
      const insertReceipt = async (accepted: SourceAccepted): Promise<void> => {
        await unit.commands.insert({
          ownerId,
          operation: 'sources.submit',
          requestKey: command.requestKey,
          fingerprint,
          status: 202,
          result: accepted,
        });
      };
      if (command.mode === 'reprocess') {
        return submitReprocess({
          unit,
          ownerId,
          command,
          insertReceipt,
          clock,
          ids,
        });
      }

      return submitRegistration({
        unit,
        ownerId,
        command,
        insertReceipt,
        clock,
        ids,
      });
    });
}
