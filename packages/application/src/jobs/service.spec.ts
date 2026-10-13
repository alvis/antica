import { describe, expect, it, vi } from 'vitest';

import { createJobService } from './service.js';

import type { JobEnvelope } from '@antica/contracts';

import type {
  OperationResult,
  TransactionPort,
  UnitOfWork,
} from '../ports/index.js';

const job: JobEnvelope = {
  id: 'job-1',
  kind: 'analysis',
  resourceId: 'record-1',
  state: { kind: 'waiting', stage: 'provider' },
  createdAt: '2026-10-13T12:00:00.000Z',
  updatedAt: '2026-10-13T12:01:00.000Z',
  result: null,
};

describe('fn:createJobService', () => {
  it('should return the persisted lifecycle state within the requested owner scope', async () => {
    const get = vi.fn(async (_id: string) => job);
    const owners: string[] = [];
    const transaction: TransactionPort = {
      run: async <T extends OperationResult<unknown>>(
        ownerId: string,
        operation: (unit: UnitOfWork) => Promise<T>,
      ): Promise<T> => {
        owners.push(ownerId);

        return operation(
          new Proxy({} as UnitOfWork, {
            get: (_target, key) => (key === 'jobs' ? { get } : undefined),
          }),
        );
      },
    };

    const result = await createJobService(transaction).get(
      'collector-1',
      job.id,
    );

    expect(result).toEqual({ success: true, data: job });
    expect(owners).toEqual(['collector-1']);
    expect(get).toHaveBeenCalledWith(job.id);
  });

  it('should report an absent job without inventing a lifecycle state', async () => {
    const transaction: TransactionPort = {
      run: async <T extends OperationResult<unknown>>(
        _ownerId: string,
        operation: (unit: UnitOfWork) => Promise<T>,
      ): Promise<T> =>
        operation(
          new Proxy({} as UnitOfWork, {
            get: (_target, key) =>
              key === 'jobs' ? { get: async () => null } : undefined,
          }),
        ),
    };

    const result = await createJobService(transaction).get(
      'collector-1',
      'missing',
    );

    expect(result).toMatchObject({
      success: false,
      error: { code: 'NOT_FOUND', retryable: false },
    });
  });
});
