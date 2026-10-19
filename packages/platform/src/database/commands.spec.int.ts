import { execFile } from 'node:child_process';

import { createRequire } from 'node:module';

import { fileURLToPath } from 'node:url';

import { promisify } from 'node:util';

import { describe, expect, inject, vi } from 'vitest';

import { collectorUserId, ensureCollectorUser } from './collector.js';

import { migrateDatabase } from './migrate.js';

import { seedIllustrativeData } from './seed.js';
import { createDatabaseTest } from './spec/fixtures/runner.js';

const url = process.env.ANTICA_TEST_DATABASE_URL;
if (!url) {
  throw new Error(
    'ANTICA_TEST_DATABASE_URL must identify an isolated PostgreSQL database',
  );
}

const phoneNumber = '+447700900123';
const illustrativeRecordId = '00000000-0000-4000-8000-000000000201';
const illustrativeLocationId = '00000000-0000-4000-8000-000000000101';
const execute = promisify(execFile);
const tsxLoader = createRequire(import.meta.url).resolve('tsx');
const repositoryDirectory = new URL('../../../../', import.meta.url);

const resources = inject('platformDatabases');
const it = createDatabaseTest(resources.commands!);

describe('database setup commands', { timeout: 30_000 }, () => {
  it.for(['migrate', 'seed'] as const)(
    'should execute the %s entry module with configured credentials',
    async (command, { connection }) => {
      vi.resetModules();
      vi.stubGlobal('process', {
        ...process,
        argv: [
          process.execPath,
          fileURLToPath(new URL(`./${command}.ts`, import.meta.url)),
        ],
        env: {
          ...process.env,
          DATABASE_URL: connection.url,
          ANTICA_COLLECTOR_PHONE: phoneNumber,
          NODE_ENV: 'test',
        },
      });
      if (command === 'migrate') {
        // This file owns the database; require the entrypoint to rebuild its schema.
        await connection.db.$executeRaw`drop schema public cascade`;
        await connection.db.$executeRaw`create schema public`;
      }

      await vi.importActual(`./${command}.js`);

      if (command === 'migrate') {
        expect(await connection.db.user.count()).toBe(0);
      } else {
        expect(
          await connection.db.user.findMany({
            select: { id: true, phoneNumber: true },
          }),
        ).toEqual([{ id: collectorUserId, phoneNumber }]);
        expect(
          await connection.db.records.findMany({ select: { id: true } }),
        ).toEqual([{ id: illustrativeRecordId }]);
      }
    },
  );

  it.for([
    { command: 'migrate', databaseUrl: '', collectorPhone: phoneNumber },
    { command: 'seed', databaseUrl: '', collectorPhone: phoneNumber },
    { command: 'seed', databaseUrl: 'configured', collectorPhone: '' },
  ])(
    'should reject the $command entry module when required configuration is absent',
    async ({ command, databaseUrl, collectorPhone }, { connection }) => {
      vi.resetModules();
      vi.stubGlobal('process', {
        ...process,
        argv: [
          process.execPath,
          fileURLToPath(new URL(`./${command}.ts`, import.meta.url)),
        ],
        env: {
          ...process.env,
          DATABASE_URL: databaseUrl ? connection.url : '',
          ANTICA_COLLECTOR_PHONE: collectorPhone,
        },
      });

      const before = await connection.db.records.count();

      await expect(vi.importActual(`./${command}.js`)).rejects.toThrow(
        /required/,
      );
      expect(await connection.db.records.count()).toBe(before);
    },
  );

  it.for([
    { directory: 'repository root', cwd: repositoryDirectory },
    { directory: 'platform package', cwd: new URL('../../', import.meta.url) },
  ])(
    'should apply migrations and seed through their executable entrypoints from $directory',
    { timeout: 30_000 },
    async ({ cwd }, { connection }) => {
      const environment = {
        ...process.env,
        DATABASE_URL: connection.url,
        ANTICA_COLLECTOR_PHONE: phoneNumber,
        NODE_ENV: 'test',
      };
      await execute(
        process.execPath,
        [
          '--import',
          tsxLoader,
          fileURLToPath(new URL('./migrate.ts', import.meta.url)),
        ],
        { cwd, env: environment },
      );
      await execute(
        process.execPath,
        [
          '--import',
          tsxLoader,
          fileURLToPath(new URL('./seed.ts', import.meta.url)),
        ],
        { cwd, env: environment },
      );
      expect(
        await connection.db.records.findMany({
          select: { id: true, description: true },
          where: { id: illustrativeRecordId },
        }),
      ).toEqual([
        {
          id: illustrativeRecordId,
          description:
            'Synthetic fixture for local development; not an attributed antique.',
        },
      ]);
    },
  );

  it.for([
    { file: './migrate.ts', databaseUrl: '', collectorPhone: phoneNumber },
    { file: './seed.ts', databaseUrl: '', collectorPhone: phoneNumber },
    {
      file: './seed.ts',
      databaseUrl: 'configured-at-runtime',
      collectorPhone: '',
    },
  ])(
    'should fail the $file command before connecting when required configuration is absent',
    async ({ file, databaseUrl, collectorPhone }, { connection }) => {
      await expect(
        execute(
          process.execPath,
          [
            '--import',
            tsxLoader,
            fileURLToPath(new URL(file, import.meta.url)),
          ],
          {
            cwd: repositoryDirectory,
            env: {
              ...process.env,
              DATABASE_URL: databaseUrl ? connection.url : '',
              ANTICA_COLLECTOR_PHONE: collectorPhone,
              NODE_ENV: 'test',
            },
          },
        ),
      ).rejects.toMatchObject({
        code: 1,
      });
    },
  );

  it('should apply committed migrations again without destroying existing data', async ({
    connection,
  }) => {
    const ownerId = await ensureCollectorUser({
      db: connection.db,
      phoneNumber,
    });

    await migrateDatabase({ url: connection.url });

    expect(
      await connection.db.user.findMany({
        select: { id: true },
        where: { id: ownerId },
      }),
    ).toEqual([{ id: collectorUserId }]);
  });

  it('should keep the configured collector identity and rejects a different phone', async ({
    connection,
  }) => {
    expect(await ensureCollectorUser({ db: connection.db, phoneNumber })).toBe(
      collectorUserId,
    );
    await expect(
      ensureCollectorUser({ db: connection.db, phoneNumber: '+447700900174' }),
    ).rejects.toThrow(Error);
    expect(
      await connection.db.user.findMany({
        select: { phoneNumber: true },
        where: { id: collectorUserId },
      }),
    ).toEqual([{ phoneNumber }]);
  });

  it('should seed one illustrative record and location and is safe to repeat', async ({
    connection,
  }) => {
    await seedIllustrativeData({ url: connection.url, phoneNumber });
    await seedIllustrativeData({ url: connection.url, phoneNumber });

    expect(
      await connection.db.records.findMany({
        select: { ownerId: true, locationId: true, description: true },
        where: { id: illustrativeRecordId },
      }),
    ).toEqual([
      {
        ownerId: collectorUserId,
        locationId: illustrativeLocationId,
        description:
          'Synthetic fixture for local development; not an attributed antique.',
      },
    ]);
    expect(
      await connection.db.locations.findMany({
        select: { label: true },
        where: { id: illustrativeLocationId },
      }),
    ).toEqual([{ label: 'Illustrative shelf' }]);
  });

  it('should refuse to insert illustrative data in production', async ({
    connection,
  }) => {
    vi.stubEnv('NODE_ENV', 'production');
    await expect(
      seedIllustrativeData({ url: connection.url, phoneNumber }),
    ).rejects.toThrow();
  });
});
