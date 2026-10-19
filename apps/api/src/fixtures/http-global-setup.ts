import { relative } from 'node:path';

import { provisionHttpResources } from './http/resources.js';

import type { TestProject } from 'vitest/node';

import type { HttpResource } from './http/resources.js';

declare module 'vitest' {
  interface ProvidedContext {
    httpResources: Readonly<Record<string, HttpResource>>;
  }
}

const suites = new Set([
  'cloud-source',
  'cloud-text-index',
  'source-providers',
  'cloud-retrieval',
  'webhook',
  'video-jobs',
  'cloud-jobs',
  'routes/location',
  'routes/record',
  'routes/record-history',
  'routes/record-messages',
  'routes/evidence',
  'routes/voice',
  'routes/knowledge-http',
  'routes/knowledge',
  'routes/source-branches',
  'routes/media',
  'routes/research-http',
  'routes/analysis',
]);

/**
 * provisions only API integration infrastructure and publishes cloneable handles
 * @param project owning API integration project
 * @returns teardown that removes only this run's databases and directories
 * @throws {AggregateError} when context publication and owned-resource cleanup both fail
 */
export default async function setup(
  project: TestProject,
): Promise<() => Promise<void>> {
  // Vitest records the initial selected run before invoking global setup
  const testFiles = project.vitest.state
    .getPaths()
    .filter((file) =>
      project.vitest
        .getModuleSpecifications(file)
        .some((specification) => specification.project === project),
    );
  const slots = testFiles
    .map((file) => relative(project.config.root, file).replaceAll('\\', '/'))
    .map((file) => file.replace(/^src\//, '').replace(/\.spec\.int\.tsx?$/, ''))
    .filter((slot) => suites.has(slot))
    .flatMap((slot) =>
      slot === 'webhook' ? [slot, 'webhook-race', 'webhook-closed'] : [slot],
    );
  const owned = await provisionHttpResources(
    process.env.ANTICA_TEST_DATABASE_URL ?? '',
    slots,
  );
  try {
    project.provide('httpResources', owned.resources);
  } catch (cause) {
    try {
      await owned.close();
    } catch (cleanupCause) {
      throw new AggregateError(
        [cause, cleanupCause],
        'HTTP context publication and cleanup failed',
      );
    }
    throw cause;
  }

  return owned.close;
}
