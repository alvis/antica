import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createDatabase } from './connection.js';

export interface MigrateParams {
  readonly url: string;
}

/** applies committed SQL migrations to a PostgreSQL database */
export async function migrateDatabase({ url }: MigrateParams): Promise<void> {
  const connection = createDatabase({ url, maxConnections: 1 });
  try {
    await migrate(connection.db, {
      migrationsFolder: fileURLToPath(
        new URL('./migrations/', import.meta.url),
      ),
    });
  } finally {
    await connection.close();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is required');
  }
  await migrateDatabase({ url });
}
