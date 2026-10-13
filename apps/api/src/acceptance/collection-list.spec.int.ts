import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { createRecordService } from '@antica/application/server';
import { createDatabase, createTransactionPort } from '@antica/platform';

import type {
  OperationResult,
  TransactionPort,
} from '@antica/application/ports';
import type { RecordCheck, RecordDetail } from '@antica/contracts';

const databaseUrl = process.env.ANTICA_TEST_DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    'ANTICA_TEST_DATABASE_URL must identify an isolated migrated acceptance database',
  );
}
const clock = { now: (): string => '2026-10-13T00:00:00.000Z' };
const ids = { create: randomUUID };

describe('Persistent collection list metadata', () => {
  it('should count only owned unfinished checks and resolve only owned location labels', async () => {
    const database = createDatabase({ url: databaseUrl });
    const ownerId = randomUUID();
    const foreignOwnerId = randomUUID();
    const transaction = createTransactionPort(database.db);
    const records = createRecordService(transaction, clock, ids);
    const locationId = randomUUID();
    const foreignLocationId = randomUUID();
    try {
      value(
        await transaction.run(ownerId, async (unit) => {
          await unit.locations.create({ id: locationId, label: '展示櫃' });

          return { success: true, data: undefined };
        }),
      );
      value(
        await transaction.run(foreignOwnerId, async (unit) => {
          await unit.locations.create({
            id: foreignLocationId,
            label: '私人儲存室',
          });

          return { success: true, data: undefined };
        }),
      );
      const first = value(
        await records.create(ownerId, randomUUID(), {
          unitKind: 'single',
          name: '甲',
          location: { locationId, detail: '' },
        }),
      );
      const second = value(
        await records.create(ownerId, randomUUID(), {
          unitKind: 'single',
          name: '乙',
          location: { locationId, detail: '' },
        }),
      );
      const third = value(
        await records.create(ownerId, randomUUID(), {
          unitKind: 'single',
          name: '丙',
          location: { locationId: foreignLocationId, detail: '' },
        }),
      );
      const fourth = value(
        await records.create(ownerId, randomUUID(), {
          unitKind: 'single',
          name: '丁',
        }),
      );
      value(
        await records.create(foreignOwnerId, randomUUID(), {
          unitKind: 'single',
          name: '外部藏品',
        }),
      );
      await addCheck(
        transaction,
        { ownerId, recordId: first.id },
        'not_started',
      );
      await addCheck(
        transaction,
        { ownerId, recordId: first.id },
        'in_progress',
      );
      await addCheck(transaction, { ownerId, recordId: first.id }, 'recorded');
      await addCheck(transaction, { ownerId, recordId: second.id }, 'recorded');
      // Legacy or imported cross-owner rows must never leak into list metadata.
      await addCheck(
        transaction,
        { ownerId: foreignOwnerId, recordId: second.id },
        'not_started',
      );
      const page = value(await records.list(ownerId, { sort: 'code' }));
      expect(
        page.items.map(({ id, locationLabel, pendingCheckCount }) => ({
          id,
          locationLabel,
          pendingCheckCount,
        })),
      ).toEqual([
        { id: first.id, locationLabel: '展示櫃', pendingCheckCount: 2 },
        { id: second.id, locationLabel: '展示櫃', pendingCheckCount: 0 },
        { id: third.id, locationLabel: null, pendingCheckCount: 0 },
        { id: fourth.id, locationLabel: null, pendingCheckCount: 0 },
      ]);
      expect(page.nextCursor).toBeNull();
      expect(
        value(
          await records.list(ownerId, { sort: 'code', hasPendingChecks: true }),
        ).items.map((item) => item.id),
      ).toEqual([first.id]);
      expect(
        value(
          await records.list(ownerId, {
            sort: 'code',
            hasPendingChecks: false,
          }),
        ).items.map((item) => item.id),
      ).toEqual([second.id, third.id, fourth.id]);
      expect(value(await records.list(randomUUID(), {}))).toEqual({
        items: [],
        nextCursor: null,
      });
    } finally {
      await database.close();
    }
  });

  it.each(['code', 'name', 'updated'] as const)(
    'should page %s ordering without repeating or losing records',
    async (sort) => {
      const database = createDatabase({ url: databaseUrl });
      const ownerId = randomUUID();
      const records = createRecordService(
        createTransactionPort(database.db),
        clock,
        ids,
      );
      try {
        const created: RecordDetail[] = [];
        for (const name of ['Alpha', 'Alpha', 'Beta', null]) {
          created.push(
            value(
              await records.create(ownerId, randomUUID(), {
                unitKind: 'single',
                name,
              }),
            ),
          );
        }
        const full = value(await records.list(ownerId, { sort }));
        const seen: string[] = [];
        let cursor: string | undefined;
        for (const expected of full.items) {
          const page = value(
            await records.list(ownerId, { sort, limit: 1, cursor }),
          );
          expect(page.items).toHaveLength(1);
          expect(page.items[0]!.id).toBe(expected.id);
          seen.push(page.items[0]!.id);
          if (!page.nextCursor) {
            break;
          }
          cursor = page.nextCursor;
        }
        expect(seen).toEqual(full.items.map((item) => item.id));
        expect(new Set(seen).size).toBe(created.length);
        if (sort === 'code') {
          expect(seen).toEqual(created.map((item) => item.id));
        }
        if (sort === 'name') {
          expect(full.items.map((item) => item.name)).toEqual([
            'Alpha',
            'Alpha',
            'Beta',
            null,
          ]);
        }
        const unmatched = value(
          await records.list(ownerId, { text: randomUUID(), sort }),
        );
        expect(unmatched).toEqual({ items: [], nextCursor: null });
      } finally {
        await database.close();
      }
    },
  );

  it('should expose only the winning concurrent record revision without changing list metadata', async () => {
    const database = createDatabase({ url: databaseUrl });
    const ownerId = randomUUID();
    const transaction = createTransactionPort(database.db);
    const records = createRecordService(transaction, clock, ids);
    try {
      const record = value(
        await records.create(ownerId, randomUUID(), {
          unitKind: 'single',
          name: 'Before',
        }),
      );
      await addCheck(
        transaction,
        { ownerId, recordId: record.id },
        'in_progress',
      );
      const results = await Promise.all(
        ['First', 'Second'].map(async (name) =>
          records.patch(ownerId, record.id, randomUUID(), {
            expectedRevision: 1,
            fields: { name },
          }),
        ),
      );
      expect(results.filter((result) => result.success)).toHaveLength(1);
      expect(results.filter((result) => !result.success)).toMatchObject([
        { success: false, error: { code: 'REVISION_CONFLICT' } },
      ]);
      const winner = results.find((result) => result.success);
      if (!winner?.success) {
        throw new Error('Expected one successful compare-and-swap');
      }
      expect(winner.data).toMatchObject({
        recordRevision: 2,
        analysisInputVersion: 2,
        evidenceVersion: 1,
      });
      expect(value(await records.list(ownerId, {})).items).toMatchObject([
        {
          id: record.id,
          name: winner.data.name,
          pendingCheckCount: 1,
          locationLabel: null,
        },
      ]);
    } finally {
      await database.close();
    }
  });
});

async function addCheck(
  transaction: TransactionPort,
  target: { ownerId: string; recordId: string },
  progress: RecordCheck['progress'],
): Promise<void> {
  value(
    await transaction.run(target.ownerId, async (unit) => {
      await unit.evidence.addCheck({
        id: randomUUID(),
        revision: 1,
        recordId: target.recordId,
        componentIds: [],
        methodId: randomUUID(),
        methodVersionId: randomUUID(),
        suggestedByRunId: null,
        progress,
        result:
          progress === 'recorded'
            ? { kind: 'present' }
            : { kind: 'unrecorded' },
        observationIds: [],
        evidenceAnchorIds: [],
        pendingActionIds: [],
        createdAt: clock.now(),
        updatedAt: clock.now(),
      });

      return { success: true, data: undefined };
    }),
  );
}

function value<T>(result: OperationResult<T>): T {
  if (!result.success) {
    throw new Error(
      `Fixture operation failed: ${result.error.code}: ${result.error.message}`,
    );
  }

  return result.data;
}
