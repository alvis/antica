import {
  createKnowledgeImportHandler,
  createKnowledgeImportService,
} from '@antica/application/server';
import { createKnowledgeImportRepository } from '@antica/platform';

import type { KnowledgeProviderRegistry } from '@antica/contracts';

import type { Persistence } from './persistence.js';

/** reviewed production adapters are added by the provider-specific import tasks */
const reviewedAdapters: KnowledgeProviderRegistry = new Map();

/**
 * shares the durable import protocol between HTTP commands and the jobs drain
 * @param persistence shared database and clock
 * @returns owner commands and the portable ID-only batch handler
 */
export function createKnowledgeImportRuntime(persistence: Persistence): {
  readonly service: ReturnType<typeof createKnowledgeImportService>;
  readonly handle: ReturnType<typeof createKnowledgeImportHandler>;
} {
  const now = persistence.clock.now.bind(persistence.clock);
  const params = {
    store: createKnowledgeImportRepository({
      db: persistence.database.db,
      now,
    }),
    registry: reviewedAdapters,
    now,
  };

  return {
    service: createKnowledgeImportService(params),
    handle: createKnowledgeImportHandler(params),
  };
}
