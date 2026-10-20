import { randomUUID } from 'node:crypto';

import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { registerRelatedKnowledgeRoute } from './knowledge-related.js';

import type { ApiEnv } from '../http.js';

import type { RelatedKnowledgeService } from './knowledge-related.js';

describe('fn:registerRelatedKnowledgeRoute', () => {
  it.each([{}, { discovery: {} }])(
    'should return a retryable unavailable response when contextual discovery is absent: %j',
    async (capabilities) => {
      const router = new Hono<ApiEnv>();
      // Only the optional discovery capability is observed by this request.
      registerRelatedKnowledgeRoute(
        router,
        capabilities as RelatedKnowledgeService,
      );
      const response = await router.request(
        `/records/${randomUUID()}/related-knowledge?locale=en`,
      );
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({
        code: 'SOURCE_UNAVAILABLE',
        retryable: true,
        requestId: expect.any(String),
      });
    },
  );
});
