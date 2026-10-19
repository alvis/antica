import {
  createKnowledgeImportHandler,
  createKnowledgeImportService,
} from '@antica/application/server';
import { createKnowledgeImportRepository } from '@antica/platform';

import { createClevelandAdapter } from './knowledge-import/providers/cleveland/adapter.js';

import type { ClevelandAdapterOptions } from './knowledge-import/providers/cleveland/adapter.js';
import type { ClevelandTopicLabel } from './knowledge-import/providers/cleveland/mapping.js';

import type { Persistence } from './persistence.js';

/**
 * shares the durable import protocol between HTTP commands and the jobs drain
 * @param persistence shared database and clock
 * @param options Cleveland transport and monthly recheck configuration
 * @returns owner commands and the portable ID-only batch handler
 */
export function createKnowledgeImportRuntime(
  persistence: Pick<Persistence, 'database' | 'clock'>,
  options?: ClevelandAdapterOptions,
): {
  readonly service: ReturnType<typeof createKnowledgeImportService>;
  readonly handle: ReturnType<typeof createKnowledgeImportHandler>;
} {
  const now = persistence.clock.now.bind(persistence.clock);
  const reviewedAdapters = new Map([
    ['cleveland', createClevelandAdapter(options)],
  ]);
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
    handle: async (jobId) => {
      const registry = new Map(reviewedAdapters);
      const store = {
        ...params.store,
        claim: async (id: string) => {
          const lease = await params.store.claim(id);
          if (lease?.run.provider === 'cleveland') {
            // charge the owner-scoped taxonomy lookup against the existing batch reservation
            const topics = await persistence.database.db.$queryRaw<
              ClevelandTopicLabel[]
            >`
              with charged as (
                update import_runs set counts = counts || jsonb_build_object(
                  'sqlOperations', (counts->>'sqlOperations')::int + 1,
                  'reservedOperations', (counts->>'reservedOperations')::int - 1
                ) where id = ${lease.run.id}::uuid and counts->>'leaseToken' = ${lease.token}
                returning owner_id
              )
              select l.topic_id as "topicId", t.facet::text as facet, l.text
              from charged c join topic_labels l on l.owner_id = c.owner_id
              join topics t on t.id = l.topic_id and t.owner_id = c.owner_id
              where t.retired_at is null order by l.topic_id, l.text`;
            registry.set(
              'cleveland',
              createClevelandAdapter({ ...options, topics }),
            );
          }

          return lease;
        },
      };

      return createKnowledgeImportHandler({ ...params, store, registry })(
        jobId,
      );
    },
  };
}
