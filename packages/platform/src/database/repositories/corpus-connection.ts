import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '../generated/client.js';

import type { DatabaseConnection } from '../connection.js';

/** owned corpus connection with actual emitted SQL statement instrumentation */
export interface CorpusConnection extends DatabaseConnection {
  readonly statementCount: () => number;
}
/**
 * opens a bounded PostgreSQL pool and counts query events including transaction control
 * @param url explicit database connection string
 * @returns instrumented connection and deterministic cleanup
 */
export function createCorpusConnection(url: string): CorpusConnection {
  let statements = 0;
  const db = new PrismaClient({
    adapter: new PrismaPg({
      connectionString: url,
      options: '-c timezone=UTC',
      max: 2,
    }),
    log: [{ emit: 'event', level: 'query' }],
    transactionOptions: { maxWait: 30_000, timeout: 60_000 },
  });
  db.$on('query', () => {
    statements += 1;
  });

  return {
    db,
    statementCount: () => statements,
    close: async () => db.$disconnect(),
  };
}
