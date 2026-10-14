import postgres from 'postgres';
import { describe, expect, vi } from 'vitest';

import { createDatabase } from '../../connection.js';

import { createDatabaseTest, createSqlTest } from './runner.js';

import type { Sql } from 'postgres';

import type { DatabaseConnection } from '../../connection.js';

import type { DatabaseResource } from '../resources.js';

const boundary = vi.hoisted(() => ({
  closed: new Set<string>(),
  database: {} satisfies Partial<DatabaseConnection['db']>,
  clients: new Map<string, Sql>(),
}));

vi.mock(
  '../../connection.js',
  () =>
    ({
      createDatabase: vi.fn<typeof createDatabase>((config) => ({
        db: boundary.database as Partial<
          DatabaseConnection['db']
        > as DatabaseConnection['db'],
        close: async (): Promise<void> => {
          boundary.closed.add(config.url);
        },
      })),
    }) satisfies Partial<typeof import('../../connection.js')>,
);

vi.mock('postgres', async (importOriginal) => {
  type PostgresModule = { default: typeof postgres };
  const original = await importOriginal<PostgresModule>();

  return {
    default: Object.assign(
      vi.fn((url: string) => {
        const client = Object.assign(vi.fn<Sql>(), {
          end: async (): Promise<void> => {
            boundary.closed.add(url);
          },
        }) satisfies Partial<Sql>;
        boundary.clients.set(url, client as Partial<Sql> as Sql);

        return client as Partial<Sql> as Sql;
      }),
      original.default,
    ),
  } satisfies PostgresModule;
});

const resource = { url: 'postgres://localhost/owned_connection' };
const it = createDatabaseTest(resource)
  .extend<{
    proofResource: DatabaseResource;
  }>({
    proofResource: [resource, { scope: 'file' }],
  })
  .extend<{
    $file: { lifetime: DatabaseResource; resource: DatabaseResource };
  }>({
    lifetime: [
      async ({ proofResource }, use) => {
        await use(proofResource);
        expect(boundary.closed.has(proofResource.url)).toBe(true);
      },
      { scope: 'file' },
    ],
    resource: [async ({ lifetime }, use) => use(lifetime), { scope: 'file' }],
  });
const resources = {
  generated: { url: 'postgres://localhost/owned_generated' },
  upgrade: { url: 'postgres://localhost/owned_upgrade' },
  backfill: { url: 'postgres://localhost/owned_backfill' },
};
const sqlTest = createSqlTest(resources)
  .extend<{
    proofResources: Readonly<Record<string, DatabaseResource>>;
  }>({
    proofResources: [resources, { scope: 'file' }],
  })
  .extend<{
    $file: {
      lifetime: Readonly<Record<string, DatabaseResource>>;
      resources: Readonly<Record<string, DatabaseResource>>;
    };
  }>({
    lifetime: [
      async ({ proofResources }, use) => {
        await use(proofResources);
        expect(
          Object.values(proofResources).map((value) =>
            boundary.closed.has(value.url),
          ),
        ).toEqual([true, true, true]);
      },
      { scope: 'file' },
    ],
    resources: [async ({ lifetime }, use) => use(lifetime), { scope: 'file' }],
  });

describe('fn:createDatabaseTest', () => {
  it('should resolve the owned descriptor before opening a usable connection and close it at file teardown', async ({
    connection,
  }) => {
    expect(connection.url).toBe(resource.url);
    expect(connection.db).toBe(boundary.database);
    expect(vi.mocked(createDatabase).mock.calls).toEqual([
      [{ url: resource.url, maxConnections: 1 }],
    ]);
    expect(boundary.closed.has(resource.url)).toBe(false);
  });
});

describe('fn:createSqlTest', () => {
  sqlTest(
    'should resolve separate resource tuples and close every SQL client after its file consumers',
    async ({ generated, upgrade, backfill }) => {
      expect([generated, upgrade, backfill]).toEqual([
        boundary.clients.get(resources.generated.url),
        boundary.clients.get(resources.upgrade.url),
        boundary.clients.get(resources.backfill.url),
      ]);
      expect(vi.mocked(postgres).mock.calls).toEqual([
        [resources.generated.url, { max: 1, prepare: false }],
        [resources.upgrade.url, { max: 1, prepare: false }],
        [resources.backfill.url, { max: 1, prepare: false }],
      ]);
      expect(
        Object.values(resources).map((value) => boundary.closed.has(value.url)),
      ).toEqual([false, false, false]);
    },
  );
});
