import { describe, expect, it, test, vi } from 'vitest';

import { createHttpFixture } from '../http.js';
import { createLocalSettings } from '../runtime.js';

import { createHttpTest } from './test.js';

import type { TestContext } from 'vitest';

import type { HttpFixture } from '../http.js';

const boundary = vi.hoisted(() => ({
  close: vi.fn<HttpFixture['close']>(async () => {}),
}));

vi.mock(
  '../http.js',
  () =>
    ({
      createHttpFixture: vi.fn<typeof createHttpFixture>(async () => {
        const transport = globalThis.fetch;
        const fixture = {
          close: boundary.close,
          request: async (path: string) => transport(path),
        } satisfies Partial<HttpFixture>;

        return fixture as Partial<HttpFixture> as HttpFixture;
      }),
    }) satisfies Partial<typeof import('../http.js')>,
);

const resource = {
  databaseUrl: 'postgres://localhost/antica_worker_test',
  directory: '/private/test-owned-worker',
  inbox: '/private/test-owned-worker/otp',
  storageRoot: '/private/test-owned-worker/objects',
};
const providerUrl = 'data:text/plain,unguarded-provider';
const httpTest = createHttpTest(resource);
const workerSettings = createLocalSettings();

describe('fn:createHttpTest worker transport', () => {
  httpTest(
    'should forward captured provider calls to the current mock',
    async ({ fixture }) => {
      const response = new Response('mocked provider');
      const transport = vi.fn<typeof fetch>(async () => response);
      vi.stubGlobal('fetch', transport);

      expect(await fixture.request(providerUrl)).toBe(response);
      expect(transport.mock.calls).toEqual([[providerUrl, undefined]]);
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2000-01-01T00:00:00Z'));
      expect(Date.now()).toBe(Date.parse('2000-01-01T00:00:00Z'));
    },
  );

  httpTest(
    'should restore timers and fail closed after automatic mock cleanup',
    async ({ fixture }) => {
      expect(vi.isFakeTimers()).toBe(false);
      expect(vi.isMockFunction(globalThis.fetch)).toBe(true);
      await expect(globalThis.fetch(providerUrl)).rejects.toBeInstanceOf(Error);
      await expect(fixture.request(providerUrl)).rejects.toBeInstanceOf(Error);
    },
  );

  httpTest(
    'should reject a non-mock transport without invoking it',
    async ({ fixture }) => {
      const attempted = vi.fn();
      vi.stubGlobal('fetch', async () => {
        attempted();

        return new Response('unexpected native transport');
      });

      await expect(fixture.request(providerUrl)).rejects.toBeInstanceOf(Error);
      expect(attempted.mock.calls).toEqual([]);
    },
  );

  httpTest(
    'should preserve a current mock transport rejection',
    async ({ fixture }) => {
      const failure = new Error('provider transport failed');
      const transport = vi.fn<typeof fetch>(async () => {
        throw failure;
      });
      vi.stubGlobal('fetch', transport);

      await expect(fixture.request(providerUrl)).rejects.toBe(failure);
      expect(transport.mock.calls).toEqual([[providerUrl, undefined]]);
    },
  );
});

/** concrete callbacks hidden by Vitest's overloaded registration spy types */
interface HttpRegistration {
  fixture: [
    (
      context: { resource: typeof resource },
      use: (fixture: HttpFixture) => Promise<void>,
    ) => Promise<void>,
    { scope: 'file' },
  ];
  clock: [
    (context: TestContext, use: () => Promise<void>) => Promise<void>,
    { auto: true },
  ];
}

/**
 * captures framework callbacks so rejected consumers can be exercised directly
 * @returns the callbacks registered by the real public factory
 */
function registerFixtures(): HttpRegistration {
  const base = test.extend<{ resource: typeof resource }>({
    resource: [resource, { scope: 'file' }],
  });
  const extend = vi.spyOn(base, 'extend');
  vi.spyOn(test, 'extend').mockReturnValueOnce(base);
  createHttpTest(resource, workerSettings);

  const registration = extend.mock.calls[0]?.[0];
  if (!registration) {
    throw new Error('Expected HTTP fixture registration');
  }
  const partial = registration satisfies Partial<HttpRegistration>;

  return partial as Partial<HttpRegistration> as HttpRegistration;
}

describe('fn:createHttpTest finalization', () => {
  it('should reject a captured dispatcher pointing to itself', async () => {
    const registration = registerFixtures();

    await registration.fixture[0]({ resource }, async (fixture) => {
      await expect(fixture.request(providerUrl)).rejects.toBeInstanceOf(Error);
    });
  });

  it('should preserve a captured request and its explicit init', async () => {
    const registration = registerFixtures();
    const request = new Request(providerUrl);
    const init = { headers: { 'x-provider-test': 'synthetic' } };
    const response = new Response('provider result');
    const transport = vi.fn<typeof fetch>(async () => response);

    await registration.fixture[0]({ resource }, async () => {
      const dispatch = globalThis.fetch;
      vi.stubGlobal('fetch', transport);

      expect(await dispatch(request, init)).toBe(response);
      expect(transport.mock.calls).toEqual([[request, init]]);
    });
  });

  it('should await file cleanup after its consumer finishes', async () => {
    const registration = registerFixtures();
    const events: string[] = [];
    boundary.close.mockImplementationOnce(async () => {
      await Promise.resolve();
      events.push('closed');
    });

    await registration.fixture[0]({ resource }, async (fixture) => {
      expect(boundary.close.mock.calls).toEqual([]);
      expect(fixture.close).toBe(boundary.close);
      events.push('used');
    });
    expect(events).toEqual(['used', 'closed']);
    expect(boundary.close.mock.calls).toEqual([[]]);
    expect(vi.mocked(createHttpFixture).mock.calls).toEqual([
      [resource, workerSettings],
    ]);
  });

  it('should release the file fixture when its consumer rejects', async () => {
    const registration = registerFixtures();
    const failure = new Error('consumer failed');

    await expect(
      registration.fixture[0]({ resource }, async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(boundary.close.mock.calls).toEqual([[]]);
  });

  it('should propagate an unsuccessful file cleanup', async () => {
    const registration = registerFixtures();
    const failure = new Error('pool close failed');
    boundary.close.mockRejectedValueOnce(failure);

    await expect(
      registration.fixture[0]({ resource }, async () => {}),
    ).rejects.toBe(failure);
    expect(boundary.close.mock.calls).toEqual([[]]);
  });

  it('should restore real timers when the test consumer rejects', async (context) => {
    const registration = registerFixtures();
    const failure = new Error('test consumer failed');

    await expect(
      registration.clock[0](context, async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2000-01-01T00:00:00Z'));
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(vi.isFakeTimers()).toBe(false);
  });
});
