import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

import postgres from 'postgres';

import type { RoleLimitContext } from './role-limit.spec.fixtures.js';

/** acquired identity and in-memory secret for only the new disposable role */
export interface RoleCredential {
  readonly roleOid: number;
  readonly password: string;
}

interface ManagerIdentity {
  readonly pid: number;
  readonly isSafe: boolean;
}

interface RoleIdentity {
  readonly oid: number;
  readonly isLimited: boolean;
}

interface Setting {
  readonly name: string;
  readonly setting: string;
}

interface CredentialStatement {
  readonly statement: string;
}

/** bounded connections with no driver diagnostic output */
export const connectionOptions = {
  max: 1,
  prepare: false,
  connect_timeout: 5,
  idle_timeout: 0,
  debug: false,
  onnotice: (): void => undefined,
  connection: { statement_timeout: 8000 },
};

const passwordBytes = 32;
const loggingSettings = {
  log_statement: 'none',
  log_min_duration_statement: '-1',
  log_min_duration_sample: '-1',
  log_parameter_max_length: '0',
  log_parameter_max_length_on_error: '0',
  log_min_error_statement: 'panic',
  log_min_messages: 'panic',
  log_duration: 'off',
};

/**
 * verifies the real manager and logging prerequisites before sending a password
 * @param context observed manager identity ledger
 * @returns completion when prerequisites hold
 */
export async function verifyRoleManager(
  context: RoleLimitContext,
): Promise<void> {
  const { manager } = context;
  const [identity] = await manager<
    ManagerIdentity[]
  >`SELECT pg_backend_pid() AS pid,
    (rolsuper AND rolcreaterole AND rolcreatedb AND current_user = session_user
      AND current_database() = 'postgres'
      AND current_setting('server_version_num')::int BETWEEN 160000 AND 169999
      AND current_setting('password_encryption') = 'scram-sha-256'
      AND current_setting('log_transaction_sample_rate')::float = 0
      AND current_setting('max_connections')::int - (SELECT count(*) FROM pg_stat_activity) > 3
      AND EXISTS (SELECT 1 FROM pg_database WHERE datname = 'template0' AND datistemplate)
      AND NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname <> 'plpgsql')
      AND NOT EXISTS (SELECT 1 FROM pg_event_trigger)) AS "isSafe"
    FROM pg_roles WHERE rolname = current_user`;
  assert(identity, 'manager identity absent');
  context.managerPid = identity.pid;
  assert.equal(identity.isSafe, true, 'manager prerequisites failed');
  const settings = await manager<
    Setting[]
  >`SELECT name, setting FROM pg_settings
    WHERE name = ANY(${[
      'shared_preload_libraries',
      'session_preload_libraries',
      'local_preload_libraries',
      'debug_print_parse',
      'debug_print_plan',
      'debug_print_rewritten',
      'log_statement_stats',
      'log_parser_stats',
      'log_planner_stats',
      'log_executor_stats',
    ]})`;
  const loggingSettingCount = 10;
  assert.equal(settings.length, loggingSettingCount, 'logging settings absent');
  assert(
    settings.every(
      ({ name, setting }) =>
        setting === (name.endsWith('_libraries') ? '' : 'off'),
    ),
    'unaccounted logging instrumentation',
  );
}

/**
 * acquires a new role with a random credential retained only in memory
 * @param context exact new role ledger
 * @returns actual role identity and its ephemeral password
 */
export async function createRoleCredential(
  context: RoleLimitContext,
): Promise<RoleCredential> {
  const password = randomBytes(passwordBytes).toString('base64url');
  const roleOid = await issueRoleCredential(context, password);

  return { roleOid, password };
}

/**
 * creates a credential using server quoting under transaction-local log controls
 * @param context exact new role ledger
 * @param password ephemeral in-memory credential
 * @returns completion after the role transaction commits
 */
async function issueRoleCredential(
  context: RoleLimitContext,
  password: string,
): Promise<number> {
  const { manager, roleName } = context;
  const names = Object.keys(loggingSettings);
  const before = await manager<Setting[]>`SELECT name, setting FROM pg_settings
    WHERE name = ANY(${names}) ORDER BY name`;
  await using restoration = new AsyncDisposableStack();
  restoration.defer(async (): Promise<void> => {
    const after = await manager<Setting[]>`SELECT name, setting FROM pg_settings
      WHERE name = ANY(${names}) ORDER BY name`;
    assert.deepEqual(after, before, 'logging settings not restored');
  });
  context.hasAttemptedRole = true;

  return await manager.begin(async (transaction): Promise<number> => {
    await transaction`SET LOCAL log_statement = 'none'`;
    await transaction`SET LOCAL log_min_duration_statement = -1`;
    await transaction`SET LOCAL log_min_duration_sample = -1`;
    await transaction`SET LOCAL log_parameter_max_length = 0`;
    await transaction`SET LOCAL log_parameter_max_length_on_error = 0`;
    await transaction`SET LOCAL log_min_error_statement = 'panic'`;
    await transaction`SET LOCAL log_min_messages = 'panic'`;
    await transaction`SET LOCAL log_duration = 'off'`;
    const effective = await transaction<
      Setting[]
    >`SELECT name, setting FROM pg_settings WHERE name = ANY(${names})`;
    assert.deepEqual(
      Object.fromEntries(effective.map(({ name, setting }) => [name, setting])),
      loggingSettings,
    );
    const [credential] = await transaction<
      CredentialStatement[]
    >`SELECT pg_catalog.format(
      'CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEROLE CREATEDB NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 1 PASSWORD %L',
      ${roleName}::text, ${password}::text) AS statement`;
    assert(credential, 'credential statement absent');
    await transaction.unsafe(credential.statement);
    const [role] = await transaction<RoleIdentity[]>`SELECT oid::int,
      (rolcanlogin AND NOT rolsuper AND rolcreatedb AND NOT rolcreaterole
        AND NOT rolreplication AND NOT rolbypassrls AND rolconnlimit = 1) AS "isLimited"
      FROM pg_roles WHERE rolname = ${roleName}`;
    assert(role, 'new role absent');
    context.roleOid = role.oid;
    assert.equal(role.isLimited, true, 'new role flags mismatch');

    return role.oid;
  });
}

/**
 * distinguishes password authentication from a trust shortcut on the same TCP path
 * @param context exact owned role identity
 * @param target actual limited-role connection URL
 * @returns completion after both probes close
 */
export async function verifyRolePasswordAuthentication(
  context: RoleLimitContext,
  target: URL,
): Promise<void> {
  const wrong = new URL(target);
  wrong.password = randomBytes(passwordBytes).toString('base64url');
  {
    const rejected = postgres(wrong.toString(), connectionOptions);
    await using closure = new AsyncDisposableStack();
    closure.defer(async (): Promise<void> => rejected.end());
    const code = await rejected`SELECT 1`.then(
      () => 'UNEXPECTED_SUCCESS',
      (error: unknown) =>
        error instanceof postgres.PostgresError ? error.code : 'OTHER_ERROR',
    );
    assert.equal(code, '28P01', 'wrong password was not rejected');
  }
  {
    const accepted = postgres(target.toString(), connectionOptions);
    await using closure = new AsyncDisposableStack();
    closure.defer(async (): Promise<void> => accepted.end());
    const [identity] = await accepted<RoleIdentity[]>`SELECT oid::int,
      (NOT rolsuper AND current_user = session_user) AS "isLimited" FROM pg_roles WHERE rolname = current_user`;
    assert.deepEqual(identity, { oid: context.roleOid, isLimited: true });
  }
}
