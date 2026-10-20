import { join } from 'node:path';

import { describe, expect } from 'vitest';

import { listPendingOutbox } from '@antica/platform/database';

import { createLocalSettings, localConfig } from '../../fixtures/runtime.js';
import { createApplicationDrain } from '../../jobs.js';
import { createKnowledgeImportRuntime } from '../../knowledge-import.js';
import { createPersistence } from '../../persistence.js';
import { createImageProviders, createTextProvider } from '../../retrieval.js';

import {
  createImportFixture,
  createRequest,
  it,
  requestRun,
} from './fixtures/database.js';
import {
  createProviderFixture,
  createSnapshot,
  instant,
} from './fixtures/provider.js';

describe('fn:createKnowledgeImportRuntime', { timeout: 60_000 }, () => {
  it('should drain a persisted import and require restart when its adapter is absent from the reviewed production registry', async ({
    database: { db, url, directory },
  }) => {
    const fixture = createImportFixture(
      db,
      createProviderFixture({ snapshots: [createSnapshot()] }),
    );
    const run = await requestRun(fixture);
    const persistence = await createPersistence({
      ...localConfig,
      DATABASE_URL: url,
      ANTICA_DEV_OTP_INBOX: join(directory, 'runtime-otp'),
      ANTICA_STORAGE_LOCAL_ROOT: join(directory, 'runtime-storage'),
    });
    try {
      const workerPersistence = {
        ...persistence,
        clock: { now: () => instant },
      };
      const runtime = createKnowledgeImportRuntime(workerPersistence);
      const settings = createLocalSettings();
      const drain = createApplicationDrain({
        settings,
        persistence: workerPersistence,
        images: createImageProviders(settings, workerPersistence),
        text: createTextProvider(settings, workerPersistence),
      });
      expect(
        await runtime.service.request(fixture.ownerId, createRequest()),
      ).toMatchObject({ success: false, error: { code: 'VALIDATION_FAILED' } });
      expect(await drain()).toMatchObject({
        inspected: 1,
        settled: 1,
        deferred: 0,
        failures: [],
      });
      expect(await listPendingOutbox(db, 10)).toEqual([]);
      expect(await runtime.service.get(fixture.ownerId, run.id)).toMatchObject({
        success: true,
        data: {
          status: 'partial',
          reason: 'RESTART_REQUIRED',
          counts: { imported: 0, processed: 0 },
        },
      });
      expect(
        await db.sourceVersions.count({ where: { ownerId: fixture.ownerId } }),
      ).toBe(0);
    } finally {
      await persistence.database.close();
    }
  });
});
