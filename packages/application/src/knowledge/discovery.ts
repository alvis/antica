import type {
  KnowledgeReadV2,
  KnowledgeSearchQuery,
  KnowledgeSearchPage,
  KnowledgeTopicsQuery,
  KnowledgeTopicsPage,
  KnowledgeTopicTreeQuery,
  KnowledgeTopicTree,
} from '@antica/contracts';

import type { OperationResult } from '../ports/result.js';

import type { KnowledgeService, KnowledgeViewResult } from './service.js';

/** bulk owner-scoped discovery and pinned detail, outside write transactions */
export interface KnowledgeDiscovery {
  search(
    ownerId: string,
    input: KnowledgeSearchQuery,
  ): Promise<OperationResult<KnowledgeSearchPage>>;
  topics(
    ownerId: string,
    input: KnowledgeTopicsQuery,
  ): Promise<OperationResult<KnowledgeTopicsPage>>;
  tree(
    ownerId: string,
    id: string,
    input: KnowledgeTopicTreeQuery,
  ): Promise<OperationResult<KnowledgeTopicTree>>;
  detail(
    ownerId: string,
    id: string,
    input: KnowledgeReadV2,
  ): Promise<KnowledgeViewResult | null>;
}

/**
 * serves bulk discovery and detail reads while preserving existing revision commands
 * @param service collector revision and compatibility operations
 * @param discovery single-statement owner-scoped reads
 * @returns integrated knowledge operations
 */
export function withKnowledgeDiscovery(
  service: KnowledgeService,
  discovery: KnowledgeDiscovery,
): KnowledgeService & { readonly discovery: KnowledgeDiscovery } {
  return {
    ...service,
    discovery,
    getV2: async (
      ownerId,
      id,
      input,
    ): Promise<OperationResult<KnowledgeViewResult>> => {
      const detail = await discovery.detail(ownerId, id, input);

      return detail
        ? { success: true, data: detail }
        : {
            success: false,
            error: {
              code: 'NOT_FOUND',
              message: 'Knowledge entry or revision not found',
              retryable: false,
            },
          };
    },
  };
}
