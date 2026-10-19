import { isDeepStrictEqual } from 'node:util';

import { imageComparisonResultSchema } from '@antica/contracts';

import { jsonValue, nullableJson } from '../json.js';

import type { ComparisonRepository } from '@antica/application/ports';
import type { ImageComparisonResult } from '@antica/contracts';

import type { Transaction } from '../transaction.js';

/**
 * persists comparison successes and rejected provider output for one owner
 * @param tx
 * @param ownerId
 */
export function createComparisonRepository(
  tx: Transaction,
  ownerId: string,
): ComparisonRepository {
  async function get(id: string): Promise<ImageComparisonResult | null> {
    const [row] = await tx.comparisonResults.findMany({
      where: { AND: [{ id }, { ownerId }] },
    });
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
      const [inserted] = await tx.comparisonResults.createManyAndReturn({
        data: {
          id,
          ownerId,
          value: jsonValue(parsed.value),
          invocation: nullableJson(parsed.invocation),
        },
        skipDuplicates: true,
        select: { id: true },
      });
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
      await tx.comparisonFailures.createMany({
        data: {
          id: failure.id,
          ownerId,
          query: jsonValue(failure.query),
          error: jsonValue(failure.error),
          audit: jsonValue(failure.audit),
          createdAt: failure.createdAt,
        },
      });
    },
  };
}
