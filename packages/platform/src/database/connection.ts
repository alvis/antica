import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from './generated/client.js';

/** database connection settings for PostgreSQL */
export interface DatabaseConfig {
  readonly url: string;
  readonly maxConnections?: number;
  readonly onQuery?: (query: string, parameters: readonly unknown[]) => void;
}

/** typed platform database and its connection cleanup capability */
export interface DatabaseConnection {
  readonly db: PrismaClient;
  readonly close: () => Promise<void>;
}

/** platform Prisma database with the complete persisted schema */
export type Database = DatabaseConnection['db'];

/**
 * creates the PostgreSQL pool and typed Prisma client
 * @param config PostgreSQL connection and pool capacity
 * @returns client and cleanup for its owned PostgreSQL pool
 */
export function createDatabase(config: DatabaseConfig): DatabaseConnection {
  const adapter = new PrismaPg({
    connectionString: config.url,
    // The PostgreSQL adapter decodes timestamptz text as UTC.
    options: '-c timezone=UTC',
    max: config.maxConnections ?? 10,
  });
  let closed = false;
  const connect = adapter.connect.bind(adapter);
  adapter.connect = async () => {
    if (closed) {
      throw new Error('Database connection is closed');
    }
    return connect();
  };
  const db = new PrismaClient({
    adapter,
    log: [{ emit: 'event', level: 'query' }],
    transactionOptions: { maxWait: 30_000, timeout: 60_000 },
  });
  db.$on('query', ({ query, params }) => {
    config.onQuery?.(query, JSON.parse(params) as unknown[]);
  });

  return {
    db,
    close: async (): Promise<void> => {
      closed = true;
      await db.$disconnect();
    },
  };
}
