import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema/index.js';

/** database connection settings for PostgreSQL */
export interface DatabaseConfig {
  readonly url: string;
  readonly maxConnections?: number;
}

/**
 * creates the PostgreSQL pool and typed Drizzle client
 */
export function createDatabase(config: DatabaseConfig): DatabaseConnection {
  const client = postgres(config.url, {
    max: config.maxConnections ?? 10,
    prepare: false,
  });
  const db = drizzle(client, { schema });
  return {
    db,
    close: async (): Promise<void> => {
      await client.end();
    },
  };
}

/** typed platform database and its connection cleanup capability */
export type DatabaseConnection = {
  readonly db: ReturnType<typeof drizzle<typeof schema>>;
  readonly close: () => Promise<void>;
};

/** platform Drizzle database with the complete persisted schema */
export type Database = DatabaseConnection['db'];
