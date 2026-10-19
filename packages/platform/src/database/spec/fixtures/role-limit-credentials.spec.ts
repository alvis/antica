import postgres from 'postgres';
import { describe, expect, it, vi } from 'vitest';

import {
  connectionOptions,
  verifyRolePasswordAuthentication,
} from './role-limit-credentials.spec.fixtures.js';
import { createRoleLimitContext } from './role-limit.spec.fixtures.js';

import type { Sql } from 'postgres';

vi.mock('postgres', async (importOriginal) => {
  const original = await importOriginal<{ default: typeof postgres }>();

  return {
    default: Object.assign(vi.fn(original.default), original.default),
  } satisfies typeof original;
});

describe('fn:verifyRolePasswordAuthentication', () => {
  it.each(['accepted', 'transport failure'])(
    'should reject an inconclusive wrong-password probe and close its connection (%s)',
    async (outcome) => {
      const context = createRoleLimitContext(
        'postgres://unused@127.0.0.1/antica_test',
      );
      const query = vi.fn<Sql>();
      const end = vi.spyOn(context.manager, 'end');
      const rejected = new Proxy(context.manager, {
        apply: async () => query`SELECT 1`,
      });
      if (outcome === 'accepted') {
        query.mockResolvedValueOnce(
          Object.assign([], {
            columns: [],
            count: 0,
            command: 'SELECT',
            statement: { name: '', string: 'SELECT 1', types: [], columns: [] },
            state: { status: 'I', pid: 1, secret: 0 },
          }),
        );
      } else {
        query.mockRejectedValueOnce(new Error('transport unavailable'));
      }
      vi.mocked(postgres)
        .mockReturnValueOnce(rejected)
        .mockReturnValueOnce(rejected);

      await expect(
        verifyRolePasswordAuthentication(
          context,
          new URL('postgres://limited@127.0.0.1/antica_test'),
        ),
      ).rejects.toThrow('wrong password was not rejected');
      expect(end).toHaveResolvedWith(undefined);
      await context.manager.end();
    },
  );
});

describe('role credential diagnostics', () => {
  it('should discard driver notices without writing diagnostics', () => {
    const log = vi.spyOn(console, 'log');
    const warn = vi.spyOn(console, 'warn');
    const error = vi.spyOn(console, 'error');

    connectionOptions.onnotice();

    expect([log.mock.calls, warn.mock.calls, error.mock.calls]).toEqual([
      [],
      [],
      [],
    ]);
  });
});
