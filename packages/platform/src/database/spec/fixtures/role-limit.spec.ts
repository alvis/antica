import { AssertionError } from 'node:assert/strict';

import postgres from 'postgres';
import { describe, expect, it, vi } from 'vitest';

import {
  closeRoleManager,
  createRoleFailure,
  createRoleLimitContext,
} from './role-limit.spec.fixtures.js';

const driverFailure = Object.assign(new postgres.PostgresError(''), {
  code: '53300',
  message: 'private credential and SQL text',
  query: 'private query',
});
const assertion = new AssertionError({ message: 'owned identity changed' });

describe('fn:createRoleFailure', () => {
  it('should preserve an owned assertion as its diagnostic cause', () => {
    const failure = createRoleFailure('scenario', assertion);

    expect(failure).toEqual(
      new Error('scenario: owned identity changed', { cause: assertion }),
    );
    expect(failure.cause).toBe(assertion);
  });

  it.each([
    driverFailure,
    new Error('private credential'),
    'private credential',
  ])(
    'should retain only a safe driver code or generic lifecycle diagnostic (%s)',
    (error) => {
      const cause = new Error(
        error === driverFailure
          ? 'PostgresError:53300'
          : 'owned lifecycle failure',
      );

      expect(createRoleFailure('manager cleanup', error)).toEqual(
        new Error(`manager cleanup: ${cause.message}`, { cause }),
      );
    },
  );

  it('should sanitize both primary and disposal errors without losing their order', () => {
    const failure = createRoleFailure(
      'external cleanup',
      new SuppressedError(driverFailure, assertion, 'private disposal detail'),
    );
    const cause = new AggregateError(
      [assertion, new Error('PostgresError:53300')],
      'primary operation: owned identity changed\ndisposal or verification: PostgresError:53300',
    );

    expect(failure).toEqual(
      new Error(`external cleanup: ${cause.message}`, { cause }),
    );
    expect(failure.cause).toMatchObject({ errors: cause.errors });
  });

  it('should sanitize every aggregate member while preserving its numbered diagnostic', () => {
    const failure = createRoleFailure(
      'helper settlement',
      new AggregateError(
        [driverFailure, new Error('private credential')],
        'private aggregate',
      ),
    );
    const cause = new AggregateError(
      [new Error('PostgresError:53300'), new Error('owned lifecycle failure')],
      'failure 1: PostgresError:53300\nfailure 2: owned lifecycle failure',
    );

    expect(failure).toEqual(
      new Error(`helper settlement: ${cause.message}`, { cause }),
    );
    expect(failure.cause).toMatchObject({ errors: cause.errors });
  });
});

describe('fn:closeRoleManager', () => {
  it('should close a manager without opening a verifier when no backend was acquired', async () => {
    const context = createRoleLimitContext(
      'postgres://unused@127.0.0.1/antica_test',
    );
    const end = vi.spyOn(context.manager, 'end');

    await expect(closeRoleManager(context)).resolves.toBeUndefined();
    expect(end).toHaveResolvedWith(undefined);
  });
});
