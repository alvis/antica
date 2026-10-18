import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { createDatabase } from '../connection.js';

import { createRecordMessageRepository } from './record-messages.js';

import type { Transaction } from '../transaction.js';

/**
 * scripts a transaction whose statements return queued rows in call order
 * @param selects rows returned by consecutive select statements
 * @returns transaction whose inserts always conflict and return no row
 */
function conflictingTransaction(selects: unknown[][]): Transaction {
  const queue = [...selects];
  const first = async () => queue.shift()?.[0] ?? null;

  const { db } = createDatabase({ url: 'postgres://localhost/unused_test' });

  return new Proxy(db, {
    get(target, property, receiver) {
      if (
        property === 'records' ||
        property === 'editDraftRuns' ||
        property === 'recordMessages'
      ) {
        return { findFirst: first };
      }
      if (property === '$queryRaw') {
        return async () => [];
      }

      return Reflect.get(target, property, receiver);
    },
  });
}

const accessible = [{ id: randomUUID() }];

describe('fn:createRecordMessageRepository', () => {
  it('should fail clearly when the conflicting collector message is gone', async () => {
    const repository = createRecordMessageRepository(
      conflictingTransaction([accessible, accessible, []]),
      randomUUID(),
    );

    await expect(
      repository.insertCollectorMessage({
        id: randomUUID(),
        recordId: randomUUID(),
        requestKey: randomUUID(),
        body: 'Hello',
        editDraftId: randomUUID(),
        createdAt: '2026-10-16T00:00:00Z',
      }),
    ).rejects.toThrow(
      'The collector message vanished after a conflicting insert',
    );
  });

  it('should fail clearly when the conflicting assistant reply is gone', async () => {
    const repository = createRecordMessageRepository(
      conflictingTransaction([accessible, accessible, []]),
      randomUUID(),
    );

    await expect(
      repository.insertAssistantReply({
        id: randomUUID(),
        recordId: randomUUID(),
        editDraftId: randomUUID(),
        body: 'Hello',
        createdAt: '2026-10-16T00:00:00Z',
      }),
    ).rejects.toThrow(
      'The assistant reply vanished after a conflicting insert',
    );
  });
});
