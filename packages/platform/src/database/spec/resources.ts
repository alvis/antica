import { randomUUID } from 'node:crypto';

import { createDatabase } from '../connection.js';
import { migrateDatabase } from '../migrate.js';

/** serializable connection descriptor for one runner-owned database */
export interface DatabaseResource {
  readonly url: string;
}

/** selected test resource and its initial schema requirement */
export interface DatabaseSlot {
  readonly id: string;
  readonly migrate: boolean;
}

/** selected database descriptors and exhaustive runner teardown */
export interface ProvisionedDatabases {
  readonly resources: Readonly<Record<string, DatabaseResource>>;
  readonly close: () => Promise<void>;
}

/**
 * provisions unique databases without opening or changing the supplied database
 * @param baseUrl loopback test identity supplying administrative credentials
 * @param slots unique identities and schema requirements of selected suites
 * @returns cloneable descriptors and idempotent owned-resource cleanup
 * @throws {TypeError} when the database identity or slot identities are unsafe
 * @throws {AggregateError} when acquisition and its unwind both fail
 */
export async function provisionDatabaseResources(
  baseUrl: string,
  slots: readonly DatabaseSlot[],
): Promise<ProvisionedDatabases> {
  const administrativeUrl = new URL(baseUrl);
  if (
    !['postgres:', 'postgresql:'].includes(administrativeUrl.protocol) ||
    !['localhost', '127.0.0.1', '[::1]'].includes(administrativeUrl.hostname) ||
    !/(?:^|_)tests?(?:_|$)/.test(administrativeUrl.pathname.slice(1)) ||
    administrativeUrl.search !== '' ||
    administrativeUrl.hash !== '' ||
    slots.some((slot) => !slot.id) ||
    new Set(slots.map((slot) => slot.id)).size !== slots.length
  ) {
    throw new TypeError(
      'Database integration requires a local test identity and unique slots',
    );
  }
  administrativeUrl.pathname = '/postgres';
  const disposals = new AsyncDisposableStack();
  try {
    const administrator = createDatabase({
      url: administrativeUrl.toString(),
      maxConnections: 1,
    });
    disposals.defer(async () => administrator.close());
    const resources: Record<string, DatabaseResource> = {};
    for (const slot of slots) {
      const name = `antica_platform_${randomUUID().replaceAll('-', '')}`;
      await administrator.db.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
      disposals.defer(async () => {
        await administrator.db.$executeRawUnsafe(`DROP DATABASE "${name}"`);
      });
      const databaseUrl = new URL(baseUrl);
      databaseUrl.pathname = `/${name}`;
      const url = databaseUrl.toString();
      if (slot.migrate) {
        await migrateDatabase({ url });
      }
      resources[slot.id] = { url };
    }

    return { resources, close: async () => disposals.disposeAsync() };
  } catch (cause) {
    try {
      await disposals.disposeAsync();
    } catch (cleanupCause) {
      throw new AggregateError(
        [cause, cleanupCause],
        'Database provisioning and cleanup failed',
      );
    }
    throw cause;
  }
}
