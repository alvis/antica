import { randomUUID } from 'node:crypto';

import postgres from 'postgres';

import { ensureCollectorUser } from '../../collector.js';
import { createDatabase } from '../../connection.js';
import { migrateDatabase } from '../../migrate.js';

import type { DatabaseConnection } from '../../connection.js';

/** suite-owned database with a synthetic collector */
export interface IsolatedDatabase extends DatabaseConnection {
  readonly url: string;
  readonly ownerId: string;
}

/**
 * creates a migrated database; cleanup can drop only this generated name
 * @returns the suite-owned connection and cleanup capability
 */
export async function createIsolatedDatabase(): Promise<IsolatedDatabase> {
  const baseUrl = process.env.ANTICA_TEST_DATABASE_URL;
  if (!baseUrl) {
    throw new Error('ANTICA_TEST_DATABASE_URL is required');
  }
  const name = `antica_suite_${randomUUID().replaceAll('-', '')}`;
  const administrator = postgres(baseUrl, { max: 1, prepare: false });
  await administrator`create database ${administrator(name)}`;
  const target = new URL(baseUrl);
  target.pathname = `/${name}`;
  const url = target.toString();
  const connection = createDatabase({ url, maxConnections: 1 });
  try {
    await migrateDatabase({ url });
    const ownerId = await ensureCollectorUser({
      db: connection.db,
      phoneNumber: '+447700900123',
    });

    return {
      ...connection,
      url,
      ownerId,
      close: async (): Promise<void> => {
        await connection.close();
        await administrator`drop database ${administrator(name)}`;
        await administrator.end();
      },
    };
  } catch (error) {
    await connection.close();
    await administrator`drop database ${administrator(name)}`;
    await administrator.end();
    throw error;
  }
}
