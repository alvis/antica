import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema/index.js';

export interface DatabaseConfig {
  readonly url: string;
  readonly maxConnections?: number;
}

/** creates the PostgreSQL pool and typed Drizzle client */
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

export type DatabaseConnection = {
  readonly db: ReturnType<typeof drizzle<typeof schema>>;
  readonly close: () => Promise<void>;
};

export type Database = DatabaseConnection['db'];
