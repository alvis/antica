import { createAnalysisRepository } from './repositories/analysis.js';
import { createComparisonRepository } from './repositories/comparisons.js';
import { createEditDraftRepository } from './repositories/edit-drafts.js';
import { createEvidenceRepository } from './repositories/evidence.js';
import { createKnowledgeRepository } from './repositories/knowledge.js';
import { createMediaRepository } from './repositories/media.js';
import { createRecordMessageRepository } from './repositories/record-messages.js';
import {
  createRecordRepository,
  createLocationRepository,
} from './repositories/records.js';

import { createResearchRepository } from './repositories/research.js';
import {
  createCommandRepository,
  createJobRepository,
  createOutboxRepository,
} from './repositories/runtime.js';
import { createSourceRepository } from './repositories/sources.js';

import { createTranscriptionRepository } from './repositories/transcripts.js';

import type {
  UnitOfWork,
  TransactionPort,
  OperationResult,
} from '@antica/application/ports';

import type { Database } from './connection.js';
import { Prisma } from './generated/client.js';

export type Transaction = Prisma.TransactionClient;

/** */
class FailedTransaction extends Error {
  public readonly result: OperationResult<unknown>;

  /** @param result */
  constructor(result: OperationResult<unknown>) {
    super('Transaction callback returned a failed operation result');
    this.result = result;
  }
}

/**
 * creates a transaction port for owner-scoped repository operations
 * @param db database capability used to open each transaction
 * @returns port whose run method supplies repositories scoped to the requested owner, rolls back on a failed operation result, and returns that result
 */
export function createTransactionPort(db: Database): TransactionPort {
  return {
    /**
     * @param ownerId
     * @param operation
     */
    async run<T extends OperationResult<unknown>>(
      ownerId: string,
      operation: (unit: UnitOfWork) => Promise<T>,
    ): Promise<T> {
      try {
        return await db.$transaction(async (tx) => {
          const unit: UnitOfWork = {
            records: createRecordRepository(tx, ownerId),
            locations: createLocationRepository(tx, ownerId),
            media: createMediaRepository(tx, ownerId),
            evidence: createEvidenceRepository(tx, ownerId),
            analyses: createAnalysisRepository(tx, ownerId),
            knowledge: createKnowledgeRepository(tx, ownerId),
            sources: createSourceRepository(tx, ownerId),
            research: createResearchRepository(tx, ownerId),
            transcriptions: createTranscriptionRepository(tx, ownerId),
            editDrafts: createEditDraftRepository(tx, ownerId),
            comparisons: createComparisonRepository(tx, ownerId),
            recordMessages: createRecordMessageRepository(tx, ownerId),
            jobs: createJobRepository(tx, ownerId),
            commands: createCommandRepository(tx, ownerId),
            outbox: createOutboxRepository(tx, ownerId),
          };
          const result = await operation(unit);
          if (!result.success) {
            throw new FailedTransaction(result);
          }

          return result;
        });
      } catch (error) {
        if (error instanceof FailedTransaction) {
          return error.result as T;
        }
        // Application ports recognize PostgreSQL's unique-violation SQLSTATE.
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          throw Object.assign(
            new Error('Unique constraint violation', { cause: error }),
            { code: '23505' },
          );
        }
        throw error;
      }
    },
  };
}
