import { parseArgs } from 'node:util';

import { createDatabase } from '../../connection.js';

import { backfillKnowledgeSearch } from './search-projection.js';

/**
 * rebuilds one owner's existing revision projections without changing envelopes
 * @param args explicit owner scope
 * @param url operator-selected database connection
 * @returns visited revision count
 */
export async function runKnowledgeSearchBackfill(
  args: readonly string[],
  url: string,
): Promise<number> {
  const { values } = parseArgs({
    args: [...args],
    options: { 'owner-id': { type: 'string' } },
    strict: true,
  });
  const ownerId = values['owner-id'];
  if (!ownerId?.trim() || !url) {
    throw new TypeError('DATABASE_URL and --owner-id are required');
  }
  const connection = createDatabase({ url, maxConnections: 1 });
  try {
    return await connection.db.$transaction(async (tx) =>
      backfillKnowledgeSearch(tx, ownerId),
    );
  } finally {
    await connection.close();
  }
}
