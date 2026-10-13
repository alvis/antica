import type { UnitOfWork, TransactionPort } from '@antica/application/ports';
import type { OperationResult } from '@antica/application/ports';
import type { Database } from './connection.js';
import {
  createRecordRepository,
  createLocationRepository,
} from './repositories/records.js';
import { createMediaRepository } from './repositories/media.js';
import { createEvidenceRepository } from './repositories/evidence.js';
import { createAnalysisRepository } from './repositories/analysis.js';
import { createKnowledgeRepository } from './repositories/knowledge.js';
import { createSourceRepository } from './repositories/sources.js';
import { createResearchRepository } from './repositories/research.js';
import { createTranscriptionRepository } from './repositories/transcripts.js';
import { createEditDraftRepository } from './repositories/edit-drafts.js';
import { createComparisonRepository } from './repositories/comparisons.js';
import {
  createCommandRepository,
  createJobRepository,
  createOutboxRepository,
} from './repositories/runtime.js';

export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

class FailedTransaction extends Error {
  public readonly result: OperationResult<unknown>;

  constructor(result: OperationResult<unknown>) {
    super('Transaction callback returned a failed operation result');
    this.result = result;
  }
}

/** runs all owner-scoped repository operations in one ACID transaction */
export function createTransactionPort(db: Database): TransactionPort {
  return {
    async run<T extends OperationResult<unknown>>(
      ownerId: string,
      operation: (unit: UnitOfWork) => Promise<T>,
    ): Promise<T> {
      try {
        return await db.transaction(async (tx) => {
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
        throw error;
      }
    },
  };
}
