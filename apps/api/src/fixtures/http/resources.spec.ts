import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';

import { describe, expect, it, vi } from 'vitest';

import { createDatabase, migrateDatabase } from '@antica/platform/database';

import { provisionHttpResources } from './resources.js';

import type { DatabaseConnection } from '@antica/platform/database';

const boundary = vi.hoisted(() => ({
  execute: vi.fn<DatabaseConnection['db']['execute']>(),
  close: vi.fn<DatabaseConnection['close']>(async () => {}),
}));

vi.mock(
  'node:fs/promises',
  () =>
    ({
      mkdtemp: vi.fn<() => ReturnType<typeof mkdtemp>>(
        async () => `/private/test-owned-${randomUUID()}`,
      ) as typeof mkdtemp,
      rm: vi.fn<typeof rm>(async () => {}),
    }) satisfies Partial<typeof import('node:fs/promises')>,
);
vi.mock(
  '@antica/platform/database',
  () =>
    ({
      createDatabase: vi.fn<typeof createDatabase>(() => {
        const db = {
          execute: boundary.execute as DatabaseConnection['db']['execute'],
        } satisfies Partial<DatabaseConnection['db']>;

        return {
          db: db as Partial<
            DatabaseConnection['db']
          > as DatabaseConnection['db'],
          close: boundary.close,
        };
      }),
      migrateDatabase: vi.fn<typeof migrateDatabase>(async () => {}),
    }) satisfies Partial<typeof import('@antica/platform/database')>,
);

describe('fn:provisionHttpResources', () => {
  it.each([
    ['malformed URL', 'not-a-url', ['records']],
    ['non-PostgreSQL URL', 'https://localhost/antica_test', ['records']],
    ['remote database', 'postgres://database.example/antica_test', ['records']],
    ['non-test database', 'postgres://localhost/antica', ['records']],
    [
      'database override',
      'postgres://localhost/antica_test?database=antica',
      ['records'],
    ],
    ['URL fragment', 'postgres://localhost/antica_test#private', ['records']],
    ['empty slot', 'postgres://localhost/antica_test', ['']],
    [
      'duplicate slots',
      'postgres://localhost/antica_test',
      ['records', 'records'],
    ],
  ] as const)(
    'should reject %s before acquiring infrastructure',
    async (_, baseUrl, slots) => {
      await expect(
        provisionHttpResources(baseUrl, slots),
      ).rejects.toBeInstanceOf(TypeError);

      expect(vi.mocked(createDatabase).mock.calls).toEqual([]);
      expect(vi.mocked(migrateDatabase).mock.calls).toEqual([]);
      expect(vi.mocked(mkdtemp).mock.calls).toEqual([]);
      expect(vi.mocked(rm).mock.calls).toEqual([]);
    },
  );

  it.each(['admin', 'create', 'migration', 'directory'] as const)(
    'should unwind only acquired resources after %s failure',
    async (stage) => {
      const failure = new Error('Infrastructure unavailable');
      if (stage === 'admin') {
        vi.mocked(createDatabase).mockImplementationOnce(() => {
          throw failure;
        });
      } else if (stage === 'create') {
        boundary.execute.mockRejectedValueOnce(failure);
      } else if (stage === 'migration') {
        vi.mocked(migrateDatabase).mockRejectedValueOnce(failure);
      } else {
        vi.mocked(mkdtemp).mockRejectedValueOnce(failure);
      }

      await expect(
        provisionHttpResources('postgres://localhost/antica_test', ['records']),
      ).rejects.toBe(failure);

      const create = [
        expect.stringMatching(/^CREATE DATABASE "antica_api_[a-f0-9]+"$/),
      ];
      const drop = [
        expect.stringMatching(/^DROP DATABASE "antica_api_[a-f0-9]+"$/),
      ];
      expect(boundary.execute.mock.calls).toEqual(
        stage === 'admin' ? [] : stage === 'create' ? [create] : [create, drop],
      );
      expect(boundary.close.mock.calls).toEqual(stage === 'admin' ? [] : [[]]);
      expect(vi.mocked(rm).mock.calls).toEqual([]);
    },
  );

  it('should retain acquisition and cleanup failures while attempting every release', async () => {
    const acquisitionFailure = new Error('Migration unavailable');
    const dropFailure = new Error('Database drop unavailable');
    const closeFailure = new Error('Admin close unavailable');
    vi.mocked(migrateDatabase).mockRejectedValueOnce(acquisitionFailure);
    boundary.execute.mockImplementationOnce(
      vi.fn<DatabaseConnection['db']['execute']>(),
    );
    boundary.execute.mockRejectedValueOnce(dropFailure);
    boundary.close.mockRejectedValueOnce(closeFailure);

    await expect(
      provisionHttpResources('postgres://localhost/antica_test', ['records']),
    ).rejects.toMatchObject({
      errors: [
        acquisitionFailure,
        {
          name: 'SuppressedError',
          error: closeFailure,
          suppressed: dropFailure,
        },
      ],
    });
    expect(boundary.execute.mock.calls).toEqual([
      [expect.stringMatching(/^CREATE DATABASE "antica_api_[a-f0-9]+"$/)],
      [expect.stringMatching(/^DROP DATABASE "antica_api_[a-f0-9]+"$/)],
    ]);
    expect(boundary.close.mock.calls).toEqual([[]]);
    expect(vi.mocked(mkdtemp).mock.calls).toEqual([]);
  });

  it('should provision independent slots and close every resource once in reverse order', async () => {
    const provisioned = await provisionHttpResources(
      'postgres://localhost/antica_test',
      ['records', 'media'],
    );
    const records = provisioned.resources.records!;
    const media = provisioned.resources.media!;
    const recordsName = new URL(records.databaseUrl).pathname.slice(1);
    const mediaName = new URL(media.databaseUrl).pathname.slice(1);

    expect(vi.mocked(createDatabase).mock.calls).toEqual([
      [{ url: 'postgres://localhost/postgres', maxConnections: 1 }],
    ]);
    expect(records).toEqual({
      databaseUrl: expect.stringMatching(
        /^postgres:\/\/localhost\/antica_api_[a-f0-9]+$/,
      ),
      directory: expect.stringMatching(/^\/private\/test-owned-/),
      inbox: `${records.directory}/otp`,
      storageRoot: `${records.directory}/objects`,
    });
    expect(media.databaseUrl).not.toBe(records.databaseUrl);
    expect(media.directory).not.toBe(records.directory);
    expect(vi.mocked(migrateDatabase).mock.calls).toEqual([
      [{ url: records.databaseUrl }],
      [{ url: media.databaseUrl }],
    ]);

    await Promise.all([provisioned.close(), provisioned.close()]);
    await provisioned.close();

    expect(boundary.execute.mock.calls).toEqual([
      [`CREATE DATABASE "${recordsName}"`],
      [`CREATE DATABASE "${mediaName}"`],
      [`DROP DATABASE "${mediaName}"`],
      [`DROP DATABASE "${recordsName}"`],
    ]);
    expect(vi.mocked(rm).mock.calls).toEqual([
      [media.directory, { recursive: true, force: true }],
      [records.directory, { recursive: true, force: true }],
    ]);
    expect(boundary.close.mock.calls).toEqual([[]]);
  });

  it('should attempt every release when directory, database, and admin cleanup all fail', async () => {
    const provisioned = await provisionHttpResources(
      'postgres://localhost/antica_test',
      ['records'],
    );
    const directoryFailure = new Error('Directory removal unavailable');
    const dropFailure = new Error('Database drop unavailable');
    const closeFailure = new Error('Admin close unavailable');
    vi.mocked(rm).mockRejectedValueOnce(directoryFailure);
    boundary.execute.mockRejectedValueOnce(dropFailure);
    boundary.close.mockRejectedValueOnce(closeFailure);

    await expect(provisioned.close()).rejects.toMatchObject({
      name: 'SuppressedError',
      error: closeFailure,
      suppressed: {
        name: 'SuppressedError',
        error: dropFailure,
        suppressed: directoryFailure,
      },
    });
    await provisioned.close();

    expect(vi.mocked(rm).mock.calls).toEqual([
      [
        provisioned.resources.records!.directory,
        { recursive: true, force: true },
      ],
    ]);
    expect(boundary.execute.mock.calls).toEqual([
      [expect.stringMatching(/^CREATE DATABASE "antica_api_[a-f0-9]+"$/)],
      [expect.stringMatching(/^DROP DATABASE "antica_api_[a-f0-9]+"$/)],
    ]);
    expect(boundary.close.mock.calls).toEqual([[]]);
  });

  it('should unwind earlier slots when a later slot migration fails', async () => {
    const failure = new Error('Second migration unavailable');
    vi.mocked(migrateDatabase)
      .mockImplementationOnce(async () => {})
      .mockRejectedValueOnce(failure);

    await expect(
      provisionHttpResources('postgres://localhost/antica_test', [
        'records',
        'media',
      ]),
    ).rejects.toBe(failure);

    const databaseNames = boundary.execute.mock.calls
      .map(([query]) => query as string)
      .filter((query) => query.startsWith('CREATE'))
      .map((query) => query.slice('CREATE DATABASE '.length));
    expect(boundary.execute.mock.calls).toEqual([
      ...databaseNames.map((name) => [`CREATE DATABASE ${name}`]),
      ...databaseNames.toReversed().map((name) => [`DROP DATABASE ${name}`]),
    ]);
    expect(databaseNames).toHaveLength(2);
    expect(vi.mocked(rm).mock.calls).toEqual([
      [
        expect.stringMatching(/^\/private\/test-owned-/),
        { recursive: true, force: true },
      ],
    ]);
    expect(boundary.close.mock.calls).toEqual([[]]);
  });
});
