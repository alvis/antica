import assert, { AssertionError } from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import postgres from 'postgres';

import {
  connectionOptions,
  createRoleCredential,
  verifyRoleManager,
  verifyRolePasswordAuthentication,
} from './role-limit-credentials.spec.fixtures.js';

import type { Sql } from 'postgres';

/** lifecycle stage retained in the safe scenario diagnostic */
export type RoleFailureStage =
  'scenario' | 'external cleanup' | 'manager cleanup' | 'helper settlement';

/** observed backend identity of an owned role or manager */
export interface RoleSession {
  readonly pid: number;
}

/** acquisition ledger for this single connection-limit scenario */
export interface RoleLimitContext {
  readonly manager: Sql;
  readonly managerUrl: string;
  readonly roleName: string;
  readonly baseName: string;
  hasAttemptedRole: boolean;
  roleOid?: number;
  baseOid?: number;
  managerPid?: number;
  settlement?: Promise<void>;
  readonly cleanupFailures: Error[];
}

/** acquired role identity returned from the real credential transaction */
export interface RoleLimitOwner extends RoleLimitContext {
  readonly roleOid: number;
}

/** acquired base and credential returned from actual provisioning */
export interface RoleLimitDatabase extends RoleLimitOwner {
  readonly baseOid: number;
  readonly url: string;
}

/** exact catalog identity of one database owned by the new role */
export interface OwnedDatabase {
  readonly oid: number;
  readonly name: string;
  readonly owner: number;
}

/**
 * validates the runner's local test identity before opening a manager
 * @param baseUrl ordinary runner-injected test URL
 * @returns acquisition ledger before any database mutation
 */
export function createRoleLimitContext(baseUrl: string): RoleLimitContext {
  const target = new URL(baseUrl);
  assert(
    ['postgres:', 'postgresql:'].includes(target.protocol) &&
      ['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname) &&
      /(?:^|_)tests?(?:_|$)/.test(target.pathname.slice(1)) &&
      target.search === '' &&
      target.hash === '',
    'invalid local test identity',
  );
  target.pathname = '/postgres';
  const roleName = `antica_role_limit_${randomUUID().replaceAll('-', '')}`;

  return {
    hasAttemptedRole: false,
    cleanupFailures: [],
    manager: postgres(target.toString(), connectionOptions),
    managerUrl: target.toString(),
    roleName,
    baseName: `${roleName}_base`,
  };
}

/**
 * provisions only the fresh role and its template0 base
 * @param context ledger established before acquisition
 * @returns in-memory credential URL for the limited role
 */
export async function provisionRoleLimitDatabase(
  context: RoleLimitContext,
): Promise<RoleLimitDatabase> {
  const { manager, roleName, baseName } = context;
  await verifyRoleManager(context);
  const collisions =
    await manager`SELECT 1 FROM pg_roles WHERE rolname = ${roleName}
    UNION ALL SELECT 1 FROM pg_database WHERE datname = ${baseName}`;
  assert.equal(collisions.length, 0, 'fresh identity collision');
  const { roleOid, password } = await createRoleCredential(context);
  await manager`CREATE DATABASE ${manager(baseName)} OWNER ${manager(roleName)} TEMPLATE template0`;
  const [base] = await manager<
    OwnedDatabase[]
  >`SELECT oid::int, datname AS name,
    datdba::int AS owner FROM pg_database WHERE datname = ${baseName}`;
  assert(base, 'new base absent');
  context.baseOid = base.oid;
  assert.equal(base.owner, context.roleOid, 'new base ownership mismatch');
  const target = new URL(context.managerUrl);
  target.username = roleName;
  target.password = password;
  target.pathname = `/${baseName}`;
  await verifyRolePasswordAuthentication(context, target);

  return Object.assign(context, {
    roleOid,
    baseOid: base.oid,
    url: target.toString(),
  });
}

/**
 * exposes a stage and sanitized nested details without relying on cause rendering
 * @param stage owned scenario lifecycle stage
 * @param error actual failure at that boundary
 * @returns safe stage failure retaining the sanitized cause tree
 */
export function createRoleFailure(
  stage: RoleFailureStage,
  error: unknown,
): Error {
  const failure = sanitizeRoleFailure(error);

  return new Error(`${stage}: ${failure.message}`, { cause: failure });
}

/**
 * projects failures without retaining query text or credentials
 * @param error actual failure at the resource boundary
 * @returns safe failure retaining an assertion or driver code
 */
function sanitizeRoleFailure(error: unknown): Error {
  if (error instanceof AssertionError) {
    return error;
  }
  if (error instanceof SuppressedError) {
    const primary = sanitizeRoleFailure(error.suppressed);
    const disposal = sanitizeRoleFailure(error.error);

    return new AggregateError(
      [primary, disposal],
      `primary operation: ${primary.message}\ndisposal or verification: ${disposal.message}`,
    );
  }
  if (error instanceof AggregateError) {
    const failures = error.errors.map(sanitizeRoleFailure);

    return new AggregateError(
      failures,
      failures
        .map((failure, index) => `failure ${index + 1}: ${failure.message}`)
        .join('\n'),
    );
  }

  return new Error(
    error instanceof postgres.PostgresError
      ? `PostgresError:${error.code}`
      : 'owned lifecycle failure',
  );
}

/**
 * closes the manager and attempts backend verification even when closing fails
 * @param context manager identity ledger with an optional observed backend PID
 * @returns completion after verification and verifier disposal
 */
export async function closeRoleManager(
  context: RoleLimitContext,
): Promise<void> {
  await using verification = new AsyncDisposableStack();
  verification.defer(async (): Promise<void> => {
    if (context.managerPid === undefined) {
      // No acquired PID was observed; only manager disposal can be verified here.
      return;
    }
    const verifier = postgres(context.managerUrl, connectionOptions);
    await using closure = new AsyncDisposableStack();
    closure.defer(async (): Promise<void> => verifier.end());
    const sessions = await verifier<
      RoleSession[]
    >`SELECT pid FROM pg_stat_activity WHERE pid = ${context.managerPid}`;
    assert.equal(sessions.length, 0, 'manager session remains');
  });
  await context.manager.end();
}
