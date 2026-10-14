import { test, vi } from 'vitest';

import { createHttpFixture } from '../http.js';
import { createLocalSettings } from '../runtime.js';

import type { TestAPI } from 'vitest';

import type { ApplicationSettings } from '../../configuration.js';
import type { HttpFixture } from '../http.js';
import type { HttpResource } from './resources.js';

/** file-owned live runtime and automatically restored per-test clock */
interface HttpTestFixtures {
  $file: { fixture: HttpFixture };
  $test: { clock: void };
}

/** values exposed to each integration test by the scoped runner fixtures */
interface HttpTestContext {
  resource: HttpResource;
  fixture: HttpFixture;
  clock: void;
}

/**
 * reconstructs an in-process runtime and closes its pool before global teardown
 * @param resource runner-provided infrastructure for this suite
 * @param settings worker-local provider configuration
 * @returns file-scoped tests with failure-safe pool and clock finalization
 */
export function createHttpTest(
  resource: HttpResource,
  settings: ApplicationSettings = createLocalSettings(),
): TestAPI<HttpTestContext> {
  return test
    .extend<{ resource: HttpResource }>({
      resource: [resource, { scope: 'file' }],
    })
    .extend<HttpTestFixtures>({
      fixture: [
        async ({ resource: ownedResource }, use) => {
          // provider clients can capture fetch during composition; dispatch only to test mocks
          const providerFetch = vi.fn<typeof fetch>(
            async (...args: Parameters<typeof fetch>) => {
              const transport = globalThis.fetch;
              if (
                transport === providerFetch ||
                !vi.isMockFunction(transport)
              ) {
                throw new Error(
                  'HTTP integration provider request requires a test transport',
                );
              }

              return transport(args[0], args[1]);
            },
          );
          vi.stubGlobal('fetch', providerFetch);
          const fixture = await createHttpFixture(ownedResource, settings);
          try {
            await use(fixture);
          } finally {
            await fixture.close();
          }
        },
        { scope: 'file' },
      ],
      clock: [
        async ({ task: _task }, use) => {
          // automatic mock restoration must never expose native fetch to providers
          vi.stubGlobal(
            'fetch',
            vi.fn<typeof fetch>(async () => {
              throw new Error(
                'HTTP integration provider request requires a test transport',
              );
            }),
          );
          try {
            await use();
          } finally {
            vi.useRealTimers();
          }
        },
        { auto: true },
      ],
    });
}
