import assert from 'node:assert/strict';

import { describe, it, vi } from 'vitest';

import { createIsolatedDatabase } from './isolated-database.js';
import {
  closeRoleManager,
  createRoleFailure,
  createRoleLimitContext,
  provisionRoleLimitDatabase,
} from './role-limit.spec.fixtures.js';

import type {
  OwnedDatabase,
  RoleLimitContext,
  RoleLimitOwner,
  RoleSession,
} from './role-limit.spec.fixtures.js';

interface Remaining {
  readonly roles: number;
  readonly databases: number;
  readonly sessions: number;
}

interface Rejection {
  readonly hasCommandFailure: boolean;
  readonly hasConnectionRefusal: boolean;
}

const baseUrl = process.env.ANTICA_TEST_DATABASE_URL;
if (!baseUrl) {
  throw new Error('a local integration database is required');
}
const helperTimeoutMs = 45000;
const testTimeoutMs = 150000;
const terminationTimeoutMs = 5000;

describe('fn:createIsolatedDatabase', () => {
  it(
    'should propagate migration connection refusal and release its generated database',
    async (): Promise<void> => assertMigrationRefusalCleanup(baseUrl),
    testTimeoutMs,
  );
});

/**
 * verifies the real refusal and retains ownership through every teardown stage
 * @param url ordinary runner-injected test database URL
 * @returns completion after the refusal and owned resource cleanup
 */
async function assertMigrationRefusalCleanup(url: string): Promise<void> {
  const context = createRoleLimitContext(url);
  const failures: Error[] = [];
  try {
    const database = await provisionRoleLimitDatabase(context);
    assert.equal(
      (await readSessions(database)).length,
      0,
      'owned sessions remain',
    );
    const original = process.env.ANTICA_TEST_DATABASE_URL;
    try {
      vi.stubEnv('ANTICA_TEST_DATABASE_URL', database.url);
      assert.deepEqual(await observeRejection(context), {
        hasCommandFailure: true,
        hasConnectionRefusal: true,
      });
    } finally {
      vi.stubEnv('ANTICA_TEST_DATABASE_URL', original);
    }
    assert.equal(
      (await readSessions(database)).length,
      0,
      'owned sessions remain',
    );
    const owned = await readOwnedDatabases(database);
    assert.deepEqual(
      owned.filter(({ name }) => name !== context.baseName),
      [],
      'generated target remains',
    );
    assert.deepEqual(owned, [
      {
        oid: context.baseOid,
        name: context.baseName,
        owner: context.roleOid,
      },
    ]);
  } catch (error) {
    failures.push(createRoleFailure('scenario', error));
  } finally {
    await cleanOwnedResources(context).catch((error: unknown) =>
      failures.push(createRoleFailure('external cleanup', error)),
    );
    await closeRoleManager(context).catch((error: unknown) =>
      failures.push(createRoleFailure('manager cleanup', error)),
    );
  }
  failures.push(...context.cleanupFailures);
  if (failures.length) {
    throw new AggregateError(failures, 'scenario or cleanup failed');
  }
}

/**
 * observes the actual public helper rejection without exposing driver diagnostics
 * @param context ledger retaining settlement for teardown
 * @returns migration command failure and connection-refusal observations
 */
async function observeRejection(context: RoleLimitContext): Promise<Rejection> {
  const operation = createIsolatedDatabase();
  context.settlement = operation
    .then(
      async (database): Promise<void> => database.close(),
      (): void => undefined,
    )
    .catch((error: unknown): void => {
      context.cleanupFailures.push(
        createRoleFailure('helper settlement', error),
      );
    });
  const error = await withDeadline(operation).then(
    () => undefined,
    (cause: unknown) => cause,
  );

  const commandError = error as Error & { code?: number; stderr?: string };

  return {
    hasCommandFailure: error instanceof Error && commandError.code === 1,
    hasConnectionRefusal: /too many connections|P2037|53300/i.test(
      commandError.stderr ?? '',
    ),
  };
}

/**
 * bounds the helper wait while leaving its settlement owned by teardown
 * @param operation real in-flight operation
 * @returns its settled value before the deadline
 */
async function withDeadline<T>(operation: Promise<T>): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error('helper deadline exceeded')),
          helperTimeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * reads only database identities owned by this scenario's role
 * @param context verified ownership ledger
 * @returns exact database OIDs and owners
 */
async function readOwnedDatabases(
  context: RoleLimitOwner,
): Promise<OwnedDatabase[]> {
  const rows = await context.manager<
    OwnedDatabase[]
  >`SELECT oid::int, datname AS name,
    datdba::int AS owner FROM pg_database WHERE datdba = ${context.roleOid} ORDER BY datname`;

  return [...rows];
}

/**
 * reads sessions belonging to only the newly owned role
 * @param context verified ownership ledger
 * @returns active backend identities
 */
async function readSessions(context: RoleLimitOwner): Promise<RoleSession[]> {
  return context.manager<
    RoleSession[]
  >`SELECT pid FROM pg_stat_activity WHERE usesysid = ${context.roleOid}`;
}

/**
 * reconciles partial acquisition and drops only this scenario's owned identities
 * @param context acquisition and settlement ledger
 * @returns completion after database, role and session absence
 */
async function cleanOwnedResources(context: RoleLimitContext): Promise<void> {
  if (!context.hasAttemptedRole) {
    return;
  }
  const { manager, roleName, baseName } = context;
  const [role] = await manager<
    Array<{ oid: number }>
  >`SELECT oid::int FROM pg_roles WHERE rolname = ${roleName}`;
  if (!role) {
    await assertOwnedResourcesAbsent(context);

    return;
  }
  if (context.roleOid !== undefined) {
    assert.equal(role.oid, context.roleOid, 'role OID changed');
  }
  const owner = Object.assign(context, { roleOid: role.oid });
  const initial = await readOwnedDatabases(owner);
  verifyOwnedInventory(context, initial);
  for (const { pid } of await readSessions(owner)) {
    const [session] = await manager<
      Array<{ terminated: boolean }>
    >`SELECT pg_terminate_backend(pid, ${terminationTimeoutMs}) AS terminated
      FROM pg_stat_activity WHERE pid = ${pid} AND usesysid = ${role.oid} AND pid <> pg_backend_pid()`;
    assert(!session || session.terminated, 'owned session termination failed');
  }
  await withDeadline(context.settlement ?? Promise.resolve());
  assert.equal((await readSessions(owner)).length, 0, 'owned sessions remain');
  const final = await readOwnedDatabases(owner);
  verifyOwnedInventory(context, final);
  for (const database of [
    ...final.filter(({ name }) => name !== baseName),
    ...final.filter(({ name }) => name === baseName),
  ]) {
    const current =
      await manager`SELECT 1 FROM pg_database WHERE oid = ${database.oid}
      AND datname = ${database.name} AND datdba = ${role.oid}`;
    assert.equal(current.length, 1, 'owned database identity changed');
    await manager`DROP DATABASE ${manager(database.name)}`;
  }
  await manager`DROP ROLE ${manager(roleName)}`;
  await assertOwnedResourcesAbsent(context);
}

/**
 * limits deletion to the exact base and at most one generated target
 * @param context original identity ledger
 * @param databases current role-owned inventory
 */
function verifyOwnedInventory(
  context: RoleLimitContext,
  databases: OwnedDatabase[],
): void {
  assert(
    databases.every(
      ({ name }) =>
        name === context.baseName || /^antica_suite_[0-9a-f]{32}$/.test(name),
    ),
    'unexpected owned database',
  );
  assert(
    databases.filter(({ name }) => name !== context.baseName).length <= 1,
    'too many owned targets',
  );
  const base = databases.find(({ name }) => name === context.baseName);
  if (base && context.baseOid !== undefined) {
    assert.equal(base.oid, context.baseOid, 'base OID changed');
  }
}

/**
 * observes absence by exact names and the recorded role identity when available
 * @param context ledger whose role OID may still be unknown after partial setup
 * @returns completion after actual role, database and session absence
 */
async function assertOwnedResourcesAbsent(
  context: RoleLimitContext,
): Promise<void> {
  const { manager, roleName, baseName } = context;
  const roleOid = context.roleOid ?? null;
  const [remaining] = await manager<Remaining[]>`SELECT
    (SELECT count(*)::int FROM pg_roles WHERE oid = ${roleOid} OR rolname = ${roleName}) AS roles,
    (SELECT count(*)::int FROM pg_database WHERE datdba = ${roleOid} OR datname = ${baseName}) AS databases,
    (SELECT count(*)::int FROM pg_stat_activity WHERE usesysid = ${roleOid} OR usename = ${roleName}) AS sessions`;
  assert.deepEqual(remaining, { roles: 0, databases: 0, sessions: 0 });
}
