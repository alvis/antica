import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createDatabase, migrateDatabase } from '@antica/platform/database';

/** serializable infrastructure owned by one integration-suite slot */
export interface HttpResource {
  readonly databaseUrl: string;
  readonly directory: string;
  readonly inbox: string;
  readonly storageRoot: string;
}

/** run-owned resources and their global teardown */
export interface ProvisionedHttpResources {
  readonly resources: Readonly<Record<string, HttpResource>>;
  readonly close: () => Promise<void>;
}

/**
 * provisions isolated databases and private directories for selected suites
 * @param baseUrl explicit local test database used for administrative access
 * @param slots unique resource identities within the selected project
 * @returns serializable handles and exhaustive owned-resource teardown
 * @throws {TypeError} when the administrative URL or slot identities are unsafe
 * @throws {AggregateError} when acquisition and its unwind both fail
 */
export async function provisionHttpResources(
  baseUrl: string,
  slots: readonly string[],
): Promise<ProvisionedHttpResources> {
  const url = new URL(baseUrl);
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    url.search !== '' ||
    url.hash !== '' ||
    !/(?:^|_)tests?(?:_|$)/.test(url.pathname.slice(1)) ||
    slots.some((slot) => !slot) ||
    new Set(slots).size !== slots.length
  ) {
    throw new TypeError(
      'HTTP integration requires a local test database and unique slots',
    );
  }
  const disposals = new AsyncDisposableStack();
  try {
    const adminUrl = new URL(baseUrl);
    adminUrl.pathname = '/postgres';
    const admin = createDatabase({
      url: adminUrl.toString(),
      maxConnections: 1,
    });
    disposals.defer(() => admin.close());
    const resources: Record<string, HttpResource> = {};
    for (const slot of slots) {
      const databaseName = `antica_api_${randomUUID().replaceAll('-', '')}`;
      await admin.db.$executeRawUnsafe(`CREATE DATABASE "${databaseName}"`);
      disposals.defer(async () => {
        await admin.db.$executeRawUnsafe(`DROP DATABASE "${databaseName}"`);
      });
      const databaseUrl = new URL(baseUrl);
      databaseUrl.pathname = `/${databaseName}`;
      await migrateDatabase({ url: databaseUrl.toString() });
      const directory = await mkdtemp(join(tmpdir(), 'antica-api-http-'));
      disposals.defer(() => rm(directory, { recursive: true, force: true }));
      resources[slot] = {
        databaseUrl: databaseUrl.toString(),
        directory,
        inbox: join(directory, 'otp'),
        storageRoot: join(directory, 'objects'),
      };
    }

    return { resources, close: () => disposals.disposeAsync() };
  } catch (cause) {
    try {
      await disposals.disposeAsync();
    } catch (cleanupCause) {
      throw new AggregateError(
        [cause, cleanupCause],
        'HTTP provisioning and cleanup failed',
      );
    }
    throw cause;
  }
}
