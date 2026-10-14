import postgres from 'postgres';
import { test } from 'vitest';

import { createDatabase } from '../../connection.js';

import type { Sql } from 'postgres';
import type { TestAPI } from 'vitest';

import type { DatabaseConnection } from '../../connection.js';

import type { DatabaseResource } from '../resources.js';

/** worker-local connection reconstructed from its runner-owned descriptor */
export interface RunnerDatabase extends DatabaseConnection {
  readonly url: string;
}

/** typed database fixture available to every test in its owning file */
export interface DatabaseFixtureContext {
  readonly connection: RunnerDatabase;
}

/** separate empty databases for fresh DDL and the two populated upgrade paths */
export interface SqlFixtureContext {
  readonly generated: Sql;
  readonly upgrade: Sql;
  readonly backfill: Sql;
}

/**
 * binds a file-owned connection to a runner-provisioned database
 * @param resource serializable descriptor injected at file scope
 * @returns tests whose worker pool closes before global database teardown
 */
export function createDatabaseTest(
  resource: DatabaseResource,
): TestAPI<DatabaseFixtureContext> {
  return test
    .extend<{ resource: DatabaseResource }>({
      resource: [resource, { scope: 'file' }],
    })
    .extend<{ $file: DatabaseFixtureContext }>({
      connection: [
        async ({ resource: ownedResource }, use) => {
          const connection = createDatabase({
            url: ownedResource.url,
            maxConnections: 1,
          });
          try {
            await use({ ...connection, url: ownedResource.url });
          } finally {
            await connection.close();
          }
        },
        { scope: 'file' },
      ],
    });
}

/**
 * binds the generated-schema scenarios to separate file-owned SQL clients
 * @param resources runner descriptors for generated, upgrade, and backfill slots
 * @returns tests with independently finalized worker pools
 */
export function createSqlTest(
  resources: Readonly<Record<string, DatabaseResource>>,
): TestAPI<SqlFixtureContext> {
  return test
    .extend<{ resources: Readonly<Record<string, DatabaseResource>> }>({
      resources: [resources, { scope: 'file' }],
    })
    .extend<{ $file: SqlFixtureContext }>({
      generated: [
        async ({ resources: ownedResources }, use) =>
          useSqlDatabase(ownedResources.generated!, use),
        { scope: 'file' },
      ],
      upgrade: [
        async ({ resources: ownedResources }, use) =>
          useSqlDatabase(ownedResources.upgrade!, use),
        { scope: 'file' },
      ],
      backfill: [
        async ({ resources: ownedResources }, use) =>
          useSqlDatabase(ownedResources.backfill!, use),
        { scope: 'file' },
      ],
    });
}

/**
 * closes the local SQL pool even when the consuming test fails
 * @param resource descriptor for one globally owned database
 * @param use runner continuation owning the fixture lifetime
 * @returns completion after the local pool has closed
 */
async function useSqlDatabase(
  resource: DatabaseResource,
  use: (database: Sql) => Promise<void>,
): Promise<void> {
  const database = postgres(resource.url, { max: 1, prepare: false });
  try {
    await use(database);
  } finally {
    await database.end();
  }
}
