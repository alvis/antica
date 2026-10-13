import { isDeepStrictEqual } from 'node:util';

import { and, eq } from 'drizzle-orm';

import { imageComparisonResultSchema } from '@antica/contracts';

import { comparisonFailures, comparisonResults } from '../schema/index.js';

import type { ComparisonRepository } from '@antica/application/ports';
import type { ImageComparisonResult } from '@antica/contracts';
import type { Transaction } from '../transaction.js';

/** Persists comparison successes and rejected provider output for one owner. */
export function createComparisonRepository(
  tx: Transaction,
  ownerId: string,
): ComparisonRepository {
  async function get(id: string): Promise<ImageComparisonResult | null> {
    const [row] = await tx
      .select()
      .from(comparisonResults)
      .where(
        and(
          eq(comparisonResults.id, id),
          eq(comparisonResults.ownerId, ownerId),
        ),
      );
    if (!row) {
      return null;
    }

    return imageComparisonResultSchema.parse({
      value: row.value,
      invocation: row.invocation,
    });
  }

  return {
    get,
    /** @param result */
    async save(result) {
      const parsed = imageComparisonResultSchema.parse(result);
      const id = parsed.value.comparisonId;
      const [inserted] = await tx
        .insert(comparisonResults)
        .values({
          id,
          ownerId,
          value: parsed.value,
          invocation: parsed.invocation,
        })
        .onConflictDoNothing()
        .returning({ id: comparisonResults.id });
      if (inserted) {
        return;
      }
      const existing = await get(id);
      if (!existing || !isDeepStrictEqual(existing, parsed)) {
        throw new Error('Comparison ID is already used by different content');
      }
    },
    /** @param failure */
    async recordFailure(failure) {
      await tx.insert(comparisonFailures).values({
        id: failure.id,
        ownerId,
        query: failure.query,
        error: failure.error,
        audit: failure.audit,
        createdAt: failure.createdAt,
      });
    },
  };
}
