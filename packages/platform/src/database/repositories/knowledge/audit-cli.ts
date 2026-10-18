import { createDatabase } from '../../connection.js';

import { auditKnowledge } from './audit.js';

/**
 * reports legacy findings before applying any explicitly selected repairs
 * @param args command arguments; only --apply is accepted
 * @param url PostgreSQL connection URL for the database being audited
 * @param writeLine output sink for machine-readable reports and per-row audit lines
 */
export async function runKnowledgeAudit(
  args: readonly string[],
  url: string,
  writeLine: (line: string) => void,
): Promise<void> {
  if (args.some((argument) => argument !== '--apply') || args.length > 1) {
    throw new TypeError('Usage: knowledge audit [--apply] with DATABASE_URL');
  }
  const database = createDatabase({ url, maxConnections: 1 });
  try {
    const dryRun = await database.db.$transaction(async (tx) =>
      auditKnowledge(tx),
    );
    writeLine(JSON.stringify({ mode: 'dry-run', ...dryRun }));
    if (args.includes('--apply')) {
      const applied = await database.db.$transaction(async (tx) =>
        auditKnowledge(tx, { apply: true }),
      );
      writeLine(JSON.stringify({ mode: 'apply', ...applied }));
    }
  } finally {
    await database.close();
  }
}
