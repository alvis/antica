import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { createDatabase } from '../connection.js';
import { comparisonFailures } from '../schema/index.js';

import { createComparisonRepository } from './comparisons.js';

import type { ComparisonFailureRecord } from '@antica/application/ports';
import type { ImageComparisonResult } from '@antica/contracts';

import type { Transaction } from '../transaction.js';

const databaseUrl = process.env.ANTICA_TEST_DATABASE_URL ?? '';
if (!databaseUrl) {
  throw new Error(
    'ANTICA_TEST_DATABASE_URL must identify an isolated migrated database',
  );
}
const rollback = new Error('Rollback comparison test transaction');

async function inRolledBackTransaction(
  operation: (tx: Transaction) => Promise<void>,
): Promise<void> {
  const database = createDatabase({ url: databaseUrl, maxConnections: 1 });
  try {
    await expect(
      database.db.transaction(async (tx) => {
        await operation(tx);
        throw rollback;
      }),
    ).rejects.toBe(rollback);
  } finally {
    await database.close();
  }
}

describe('fn:createComparisonRepository', () => {
  it("should persist one owner's immutable comparison and refuse conflicting reuse of its ID", async () => {
    await inRolledBackTransaction(async (tx) => {
      const ownerId = randomUUID();
      const foreignOwnerId = randomUUID();
      const comparisonId = randomUUID();
      const anchorId = randomUUID();
      const recordId = randomUUID();
      const originalAssetId = randomUUID();
      const result: ImageComparisonResult = {
        value: {
          comparisonId,
          queryAnchorId: anchorId,
          selected: { kind: 'collection', recordId, originalAssetId },
          selectedRegion: null,
          selectedCanonicalViewId: null,
          similaritiesZhHant: ['同樣的釉色'],
          differencesZhHant: [],
          limitsZhHant: [],
          citations: [],
        },
        invocation: null,
      };
      const repository = createComparisonRepository(tx, ownerId);
      const foreignRepository = createComparisonRepository(tx, foreignOwnerId);

      expect(await repository.get(comparisonId)).toBeNull();
      await repository.save(result);
      expect(await repository.get(comparisonId)).toEqual(result);
      expect(await foreignRepository.get(comparisonId)).toBeNull();
      await repository.save(result);
      await expect(
        repository.save({
          ...result,
          value: { ...result.value, similaritiesZhHant: ['不同內容'] },
        }),
      ).rejects.toThrow(Error);
      expect(await repository.get(comparisonId)).toEqual(result);
    });
  });

  it('should persist rejected comparison output with its owner and failure audit', async () => {
    await inRolledBackTransaction(async (tx) => {
      const ownerId = randomUUID();
      const id = randomUUID();
      const selected = {
        kind: 'collection' as const,
        recordId: randomUUID(),
        originalAssetId: randomUUID(),
      };
      const failure: ComparisonFailureRecord = {
        id,
        query: {
          mode: 'compare',
          queryAnchorId: randomUUID(),
          selected,
          selectedRegion: null,
          selectedCanonicalViewId: null,
        },
        error: {
          code: 'PROVIDER_UNAVAILABLE',
          message: 'Provider declined comparison',
          retryable: true,
        },
        audit: { invocation: null, rawOutput: { rejected: true } },
        createdAt: '2026-10-13T04:00:00.000Z',
      };

      await createComparisonRepository(tx, ownerId).recordFailure(failure);
      const [stored] = await tx
        .select()
        .from(comparisonFailures)
        .where(eq(comparisonFailures.id, id));
      expect(stored).toMatchObject({
        ownerId,
        query: failure.query,
        error: failure.error,
        audit: failure.audit,
      });
      expect(await createComparisonRepository(tx, ownerId).get(id)).toBeNull();
    });
  });
});
