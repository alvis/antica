import { randomUUID } from 'node:crypto';

import { Hono } from 'hono';
import { describe, expect, test } from 'vitest';

import { createKnowledgeImportService } from '@antica/application/server';
import {
  createDatabase,
  createKnowledgeImportRepository,
} from '@antica/platform/database';

import { provisionHttpResources } from '../fixtures/http/resources.js';

import { invalid, RequestBodyError } from '../http.js';

import { createKnowledgeImportRoutes } from './knowledge-import.js';

import type { KnowledgeImportService } from '@antica/application/server';
import type {
  KnowledgeImportRequest,
  KnowledgeProviderAdapter,
} from '@antica/contracts';

import type { ApiEnv } from '../http.js';

const now = '2026-10-19T00:00:00.000Z';
const provider: KnowledgeProviderAdapter = {
  provider: 'fixture',
  adapterVersion: 'fixture-v1',
  list: async () => ({ objects: [] }),
  fetch: async () => ({ kind: 'missing' }),
  map: () => {
    throw new Error('Command routes must not map provider data');
  },
};
const it = test.extend<{ service: KnowledgeImportService }>({
  service: async ({ task: _task }, use) => {
    const owned = await provisionHttpResources(
      process.env.ANTICA_TEST_DATABASE_URL ?? '',
      ['knowledge-import'],
    );
    const connection = createDatabase({
      url: owned.resources['knowledge-import']!.databaseUrl,
      maxConnections: 1,
    });
    try {
      await use(
        createKnowledgeImportService({
          store: createKnowledgeImportRepository({
            db: connection.db,
            now: () => now,
          }),
          registry: new Map([['fixture', provider]]),
          now: () => now,
        }),
      );
    } finally {
      await connection.close();
      await owned.close();
    }
  },
});

describe('fn:createKnowledgeImportRoutes', { timeout: 60_000 }, () => {
  it('should submit idempotently and hide status, resume and cancel from a different owner', async ({
    service,
  }) => {
    const ownerId = randomUUID();
    const owner = router(service, ownerId);
    const other = router(service, randomUUID());
    const input = request();
    const created = await owner.request('/v1/knowledge/imports', json(input));
    expect(created.status).toBe(202);
    const accepted = await service.request(ownerId, input);
    if (!accepted.success) {
      throw new Error('Expected admitted run');
    }
    const run = accepted.data;
    expect(await created.json()).toMatchObject({
      id: run.id,
      jobId: run.jobId,
    });
    const duplicate = await owner.request('/v1/knowledge/imports', json(input));
    expect(await duplicate.json()).toMatchObject({
      id: run.id,
      jobId: run.jobId,
    });

    for (const [suffix, method] of [
      ['', 'GET'],
      ['/resume', 'POST'],
      ['/cancel', 'POST'],
    ] as const) {
      const response = await other.request(
        `/v1/knowledge/imports/${run.id}${suffix}`,
        { method },
      );
      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({ code: 'NOT_FOUND' });
    }
    expect(
      (await owner.request(`/v1/knowledge/imports/${run.id}`)).status,
    ).toBe(200);
    const cancelled = await owner.request(
      `/v1/knowledge/imports/${run.id}/cancel`,
      { method: 'POST' },
    );
    expect(cancelled.status).toBe(200);
    expect(await cancelled.json()).toMatchObject({
      id: run.id,
      status: 'cancelled',
    });
    const resumed = await owner.request(
      `/v1/knowledge/imports/${run.id}/resume`,
      { method: 'POST' },
    );
    expect(resumed.status).toBe(200);
    expect(await resumed.json()).toMatchObject({
      id: run.id,
      jobId: run.jobId,
    });
  });

  it('should reject unreviewed providers, arbitrary URL fields and URL object identifiers', async ({
    service,
  }) => {
    const app = router(service, randomUUID());
    const input = request();
    const invalid = [
      { ...input, selection: { ...input.selection, provider: 'unreviewed' } },
      {
        ...input,
        selection: { ...input.selection, url: 'http://127.0.0.1/private' },
      },
      {
        ...input,
        selection: {
          ...input.selection,
          objectIds: ['https://example.invalid/object'],
        },
      },
      {
        ...input,
        selection: {
          kind: 'query',
          provider: 'fixture',
          query: { text: 'https://example.invalid/search' },
          maxObjects: 1,
          maxBytes: 100,
          deadline: '2026-10-20T00:00:00.000Z',
        },
      },
    ];
    for (const body of invalid) {
      const response = await app.request('/v1/knowledge/imports', json(body));
      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({
        code: 'VALIDATION_FAILED',
      });
    }
  });

  it('should reject malformed JSON and invalid bounds without creating a run', async ({
    service,
  }) => {
    const app = router(service, randomUUID());
    const malformed = await app.request('/v1/knowledge/imports', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{',
    });
    expect(malformed.status).toBe(422);
    for (const [suffix, method] of [
      ['', 'GET'],
      ['/resume', 'POST'],
      ['/cancel', 'POST'],
    ] as const) {
      const response = await app.request(
        `/v1/knowledge/imports/not-a-uuid${suffix}`,
        { method },
      );
      expect(response.status).toBe(422);
    }
    const input = request();
    for (const selection of [
      { ...input.selection, maxObjects: 251 },
      { ...input.selection, maxBytes: 0 },
      { ...input.selection, deadline: now },
    ]) {
      const response = await app.request(
        '/v1/knowledge/imports',
        json({ ...input, selection }),
      );
      expect(response.status).toBe(422);
    }
  });
});

/**
 * binds authenticated middleware output while exercising the real route and service
 * @param service real persistence-backed import commands
 * @param ownerId authenticated owner identity
 * @returns mounted v1 route
 */
function router(
  service: KnowledgeImportService,
  ownerId: string,
): Hono<ApiEnv> {
  const app = new Hono<ApiEnv>();
  app.onError((error, context) => {
    if (error instanceof SyntaxError || error instanceof RequestBodyError) {
      return invalid(context);
    }
    throw error;
  });
  app.use('*', async (context, next) => {
    context.set('ownerId', ownerId);
    await next();
  });
  app.route('/v1', createKnowledgeImportRoutes(service));

  return app;
}

/**
 * creates a bounded command request
 * @returns unique idempotent request
 */
function request(): KnowledgeImportRequest {
  return {
    requestKey: randomUUID(),
    sqlOperationBudget: 4_000,
    selection: {
      kind: 'ids',
      provider: 'fixture',
      objectIds: ['object-1'],
      maxObjects: 1,
      maxBytes: 10_000,
      deadline: '2026-10-20T00:00:00.000Z',
    },
  };
}

/**
 * encodes a POST body through the same HTTP boundary as an operator
 * @param body candidate request
 * @returns JSON request options
 */
function json(body: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}
