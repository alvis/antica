import { ok } from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { test } from 'vitest';

import {
  createKnowledgeImportHandler,
  createKnowledgeImportService,
} from '@antica/application/server';

import {
  createDatabase,
  createKnowledgeImportRepository,
} from '@antica/platform/database';

import { provisionHttpResources } from '../../../fixtures/http/resources.js';

import { instant } from './provider.js';

import type { KnowledgeImportService } from '@antica/application/server';
import type {
  KnowledgeImportRequest,
  KnowledgeImportRun,
  KnowledgeImportStore,
  KnowledgeProviderAdapter,
} from '@antica/contracts';

import type { Database } from '@antica/platform/database';

/** independently provisioned connection for real API integration */
interface ImportDatabaseFixture {
  readonly database: {
    readonly db: Database;
    readonly url: string;
    readonly directory: string;
  };
}

/** real import protocol plus an explicitly movable clock */
interface ImportFixture {
  readonly ownerId: string;
  readonly clock: { value: string };
  readonly store: KnowledgeImportStore;
  readonly service: KnowledgeImportService;
  readonly handle: ReturnType<typeof createKnowledgeImportHandler>;
}

const defaultOperationBudget = 4_000;

export const it = test.extend<ImportDatabaseFixture>({
  database: async ({ task: _task }, use) => {
    const url = process.env.ANTICA_TEST_DATABASE_URL;
    ok(url, 'ANTICA_TEST_DATABASE_URL is required');
    const owned = await provisionHttpResources(url, ['import']);
    const connection = createDatabase({
      url: owned.resources.import!.databaseUrl,
      maxConnections: 1,
    });
    const { db } = connection;
    try {
      await use({
        db,
        url: owned.resources.import!.databaseUrl,
        directory: owned.resources.import!.directory,
      });
    } finally {
      await connection.close();
      await owned.close();
    }
  },
});

/**
 * binds real persistence and application services to a deterministic clock
 * @param db isolated migrated database
 * @param adapter test-only provider
 * @returns owner, clock and portable service entrypoints
 */
export function createImportFixture(
  db: Database,
  adapter: KnowledgeProviderAdapter,
): ImportFixture {
  const clock = { value: instant };
  const store = createKnowledgeImportRepository({
    db,
    now: () => clock.value,
    leaseMilliseconds: 1_000,
  });
  const registry = new Map([[adapter.provider, adapter]]);
  const params = { store, registry, now: () => clock.value, random: () => 0 };

  return {
    ownerId: randomUUID(),
    clock,
    store,
    service: createKnowledgeImportService(params),
    handle: createKnowledgeImportHandler(params),
  };
}

/**
 * creates a bounded request varied by object set or operation budget
 * @param objectIds explicit approved fixture identities
 * @param sqlOperationBudget maximum permitted SQL count
 * @returns import request with its own idempotency key
 */
export function createRequest(
  objectIds = ['object-1'],
  sqlOperationBudget = defaultOperationBudget,
): KnowledgeImportRequest {
  return {
    requestKey: randomUUID(),
    sqlOperationBudget,
    selection: {
      kind: 'ids',
      provider: 'fixture',
      objectIds,
      maxObjects: objectIds.length,
      maxBytes: 2_097_152,
      deadline: '2026-10-20T00:00:00.000Z',
    },
  };
}

/**
 * submits through the real service and fails setup if admission is rejected
 * @param fixture owner-scoped application fixture
 * @param input bounded request
 * @returns accepted run
 */
export async function requestRun(
  fixture: ReturnType<typeof createImportFixture>,
  input = createRequest(),
): Promise<KnowledgeImportRun> {
  const result = await fixture.service.request(fixture.ownerId, input);
  ok(result.success, JSON.stringify(result));

  return result.data;
}
