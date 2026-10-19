import { describe, expect, it, vi } from 'vitest';

import { createDatabase } from '../connection.js';
import { migrateDatabase } from '../migrate.js';

import { provisionDatabaseResources } from './resources.js';

import type { DatabaseConnection } from '../connection.js';

const boundary = vi.hoisted(() => ({
  execute: vi.fn<DatabaseConnection['db']['$executeRawUnsafe']>(),
  close: vi.fn<DatabaseConnection['close']>(async () => {}),
}));

vi.mock(
  '../connection.js',
  () =>
    ({
      createDatabase: vi.fn<typeof createDatabase>(() => ({
        db: {
          $executeRawUnsafe:
            boundary.execute as DatabaseConnection['db']['$executeRawUnsafe'],
        } satisfies Partial<DatabaseConnection['db']> as Partial<
          DatabaseConnection['db']
        > as DatabaseConnection['db'],
        close: boundary.close,
      })),
    }) satisfies Partial<typeof import('../connection.js')>,
);

vi.mock(
  '../migrate.js',
  () =>
    ({
      migrateDatabase: vi.fn<typeof migrateDatabase>(async () => {}),
    }) satisfies Partial<typeof import('../migrate.js')>,
);

describe('fn:provisionDatabaseResources', () => {
  it('should attempt earlier drops and admin close after a drop fails without repeating cleanup', async () => {
    const owned = await provisionDatabaseResources(
      'postgres://localhost/antica_test',
      [
        { id: 'first', migrate: false },
        { id: 'second', migrate: false },
      ],
    );
    const failure = new Error('Second database cannot be dropped');
    boundary.execute.mockRejectedValueOnce(failure);

    await expect(owned.close()).rejects.toBe(failure);
    await owned.close();

    const first = new URL(owned.resources.first!.url).pathname.slice(1);
    const second = new URL(owned.resources.second!.url).pathname.slice(1);
    expect(boundary.execute.mock.calls).toEqual([
      [`CREATE DATABASE "${first}"`],
      [`CREATE DATABASE "${second}"`],
      [`DROP DATABASE "${second}"`],
      [`DROP DATABASE "${first}"`],
    ]);
    expect(boundary.close.mock.calls).toEqual([[]]);
  });

  it.each([
    ['malformed URL', 'not-a-url', []],
    ['non-PostgreSQL URL', 'https://localhost/antica_test', []],
    ['remote host', 'postgres://database.example/antica_test', []],
    ['non-test database', 'postgres://localhost/antica', []],
    [
      'empty slot',
      'postgres://localhost/antica_test',
      [{ id: '', migrate: true }],
    ],
    [
      'duplicate slots',
      'postgres://localhost/antica_test',
      [
        { id: 'same', migrate: true },
        { id: 'same', migrate: false },
      ],
    ],
  ] as const)(
    'should reject %s before acquiring infrastructure',
    async (_, url, slots) => {
      await expect(
        provisionDatabaseResources(url, slots),
      ).rejects.toBeInstanceOf(TypeError);

      expect(vi.mocked(createDatabase).mock.calls).toEqual([]);
      expect(vi.mocked(migrateDatabase).mock.calls).toEqual([]);
      expect(boundary.execute.mock.calls).toEqual([]);
    },
  );

  it('should unwind earlier databases in reverse order when a later migration fails', async () => {
    const failure = new Error('Second migration unavailable');
    vi.mocked(migrateDatabase)
      .mockImplementationOnce(async () => {})
      .mockRejectedValueOnce(failure);

    await expect(
      provisionDatabaseResources('postgres://localhost/antica_test', [
        { id: 'commands', migrate: true },
        { id: 'constraints', migrate: true },
      ]),
    ).rejects.toBe(failure);

    const created = boundary.execute.mock.calls
      .slice(0, 2)
      .map(([query]) => query.slice('CREATE DATABASE '.length));
    expect(created).toHaveLength(2);
    expect(boundary.execute.mock.calls).toEqual([
      ...created.map((name) => [`CREATE DATABASE ${name}`]),
      ...created.toReversed().map((name) => [`DROP DATABASE ${name}`]),
    ]);
    expect(boundary.close.mock.calls).toEqual([[]]);
  });

  it('should retain acquisition and cleanup failures while attempting every acquired release', async () => {
    const acquisition = new Error('Migration unavailable');
    const drop = new Error('Drop unavailable');
    const close = new Error('Close unavailable');
    vi.mocked(migrateDatabase).mockRejectedValueOnce(acquisition);
    boundary.execute.mockImplementationOnce(
      vi.fn<DatabaseConnection['db']['$executeRawUnsafe']>(),
    );
    boundary.execute.mockRejectedValueOnce(drop);
    boundary.close.mockRejectedValueOnce(close);

    await expect(
      provisionDatabaseResources('postgres://localhost/antica_test', [
        { id: 'commands', migrate: true },
      ]),
    ).rejects.toMatchObject({
      errors: [
        acquisition,
        { name: 'SuppressedError', error: close, suppressed: drop },
      ],
    });

    expect(boundary.execute.mock.calls).toEqual([
      [expect.stringMatching(/^CREATE DATABASE "antica_platform_[a-f0-9]+"$/)],
      [expect.stringMatching(/^DROP DATABASE "antica_platform_[a-f0-9]+"$/)],
    ]);
    expect(boundary.close.mock.calls).toEqual([[]]);
  });

  it.each(['?database=existing_database', '#fragment'])(
    'should reject URL override %s before any I/O even when no slots are selected',
    async (suffix) => {
      await expect(
        provisionDatabaseResources(
          `postgres://localhost/antica_test${suffix}`,
          [],
        ),
      ).rejects.toBeInstanceOf(TypeError);

      expect(vi.mocked(createDatabase).mock.calls).toEqual([]);
      expect(vi.mocked(migrateDatabase).mock.calls).toEqual([]);
      expect(boundary.execute.mock.calls).toEqual([]);
    },
  );

  it('should isolate slots, migrate only requested schemas, and release once in reverse order', async () => {
    const baseUrl = new URL('postgres://localhost:5432/antica_test');
    baseUrl.username = 'collector';
    baseUrl.password = 'synthetic-test-password';
    const owned = await provisionDatabaseResources(baseUrl.toString(), [
      { id: 'commands', migrate: true },
      { id: 'generated', migrate: false },
    ]);
    const commands = new URL(owned.resources.commands!.url);
    const generated = new URL(owned.resources.generated!.url);

    expect(commands.pathname).not.toBe(generated.pathname);
    expect(owned.resources).toEqual({
      commands: { url: expect.stringMatching(/\/antica_platform_[a-f0-9]+$/) },
      generated: { url: expect.stringMatching(/\/antica_platform_[a-f0-9]+$/) },
    });
    expect(
      [commands, generated].map((url) => ({
        username: url.username,
        password: url.password,
        hostname: url.hostname,
        port: url.port,
      })),
    ).toEqual([
      {
        username: 'collector',
        password: 'synthetic-test-password',
        hostname: 'localhost',
        port: '5432',
      },
      {
        username: 'collector',
        password: 'synthetic-test-password',
        hostname: 'localhost',
        port: '5432',
      },
    ]);
    expect(vi.mocked(createDatabase).mock.calls).toEqual([
      [
        {
          url: new URL('/postgres', baseUrl).toString(),
          maxConnections: 1,
        },
      ],
    ]);
    expect(vi.mocked(migrateDatabase).mock.calls).toEqual([
      [{ url: commands.toString() }],
    ]);

    await Promise.all([owned.close(), owned.close()]);
    await owned.close();

    expect(boundary.execute.mock.calls).toEqual([
      [`CREATE DATABASE "${commands.pathname.slice(1)}"`],
      [`CREATE DATABASE "${generated.pathname.slice(1)}"`],
      [`DROP DATABASE "${generated.pathname.slice(1)}"`],
      [`DROP DATABASE "${commands.pathname.slice(1)}"`],
    ]);
    expect(boundary.close.mock.calls).toEqual([[]]);
    expect(boundary.close.mock.invocationCallOrder[0]).toBeGreaterThan(
      boundary.execute.mock.invocationCallOrder.at(-1)!,
    );
  });
});
