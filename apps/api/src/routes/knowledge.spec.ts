import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import {
  createKnowledgeService,
  createSourceService,
} from '@antica/application/server';

import { knowledgeInput } from '../fixtures/knowledge.js';

import { createKnowledgeRoutes } from './knowledge.js';

import type { TransactionPort } from '@antica/application/ports';

const transaction: TransactionPort = {
  run: async () => {
    throw new Error('Unexpected repository operation');
  },
};
const clock = { now: (): string => '2026-10-19T00:00:00.000Z' };
const ids = { create: randomUUID };

describe('Knowledge revision response integrity', () => {
  it('should reject discovery requests explicitly when the service lacks that capability', async () => {
    const router = createKnowledgeRoutes(
      createSourceService({ transaction, clock, ids }),
      createKnowledgeService(transaction, clock, ids),
    );
    for (const path of [
      '/knowledge/search',
      '/knowledge/topics',
      `/knowledge/topics/${randomUUID()}/tree`,
    ]) {
      const response = await router.request(path);
      expect(await response.json()).toMatchObject({ code: 'INDEX_NOT_READY' });
    }
  });

  it('should withhold a legacy detail if its exact revision hash cannot be read', async () => {
    const knowledge = createKnowledgeService(transaction, clock, ids);
    const id = randomUUID();
    vi.spyOn(knowledge, 'get').mockResolvedValue({
      success: true,
      data: {
        entry: {
          id,
          revision: 1,
          displayCode: 'KN-1',
          status: 'draft',
          savedBy: null,
          createdAt: clock.now(),
          updatedAt: clock.now(),
          content: knowledgeInput().content,
          methodIds: [],
        },
        methods: [],
        methodVersions: [],
        referenceImages: [],
        citations: [],
      },
    });
    vi.spyOn(knowledge, 'getV2').mockResolvedValue({
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: 'Revision no longer readable',
        retryable: false,
      },
    });
    const router = createKnowledgeRoutes(
      createSourceService({ transaction, clock, ids }),
      knowledge,
    );
    const response = await router.request(
      `/knowledge/${id}?methodVersionId=${randomUUID()}`,
    );
    expect(response.status).toBe(404);
    expect(response.headers.get('etag')).toBeNull();
    expect(await response.json()).toMatchObject({ code: 'NOT_FOUND' });
  });
});
