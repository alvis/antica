import { relative } from 'node:path';

import { provisionDatabaseResources } from './resources.js';

import type { TestProject } from 'vitest/node';

import type { DatabaseResource, DatabaseSlot } from './resources.js';

declare module 'vitest' {
  interface ProvidedContext {
    platformDatabases: Readonly<Record<string, DatabaseResource>>;
  }
}

const slotsByFile: Readonly<Record<string, readonly DatabaseSlot[]>> = {
  'src/database/repositories/knowledge/search.spec.int.ts': [
    { id: 'knowledge-search', migrate: true },
  ],
  'src/database/repositories/runtime.spec.int.ts': [
    { id: 'runtime', migrate: true },
  ],
  'src/database/source-artifacts.spec.int.ts': [
    { id: 'source-artifacts', migrate: true },
  ],
  'src/database/repositories/comparisons.spec.int.ts': [
    { id: 'comparisons', migrate: true },
  ],
  'src/database/repositories/transcripts.spec.int.ts': [
    { id: 'transcripts', migrate: true },
  ],
  'src/database/repositories/edit-drafts.spec.int.ts': [
    { id: 'edit-drafts', migrate: true },
  ],
  'src/database/commands.spec.int.ts': [{ id: 'commands', migrate: true }],
  'src/database/schema/constraints.spec.int.ts': [
    { id: 'constraints', migrate: true },
  ],
  'src/database/schema/generated.spec.int.ts': [
    { id: 'generated', migrate: false },
    { id: 'upgrade', migrate: false },
    { id: 'backfill', migrate: false },
    { id: 'shadow', migrate: false },
  ],
  'src/database/repositories/sources.spec.int.ts': [
    { id: 'sources', migrate: true },
  ],
  'src/database/repositories/knowledge.spec.int.ts': [
    { id: 'knowledge', migrate: true },
  ],
  'src/database/retrieval.spec.int.ts': [{ id: 'retrieval', migrate: true }],
  'src/database/repositories/record-history.spec.int.ts': [
    { id: 'record-history', migrate: true },
  ],
  'src/database/repositories/evidence-create.spec.int.ts': [
    { id: 'evidence-create', migrate: true },
  ],
  'src/database/repositories/record-messages.spec.int.ts': [
    { id: 'record-messages', migrate: true },
  ],
};

/**
 * provisions only selected Platform suites and publishes serializable handles
 * @param project owning Platform integration project
 * @returns teardown that drops only this run's generated database identities
 * @throws {AggregateError} when context publication and its cleanup both fail
 */
export async function setup(
  project: TestProject,
): Promise<() => Promise<void>> {
  const testFiles = project.vitest.state
    .getPaths()
    .filter((file) =>
      project.vitest
        .getModuleSpecifications(file)
        .some((specification) => specification.project === project),
    );
  const slots = testFiles.flatMap(
    (file) =>
      slotsByFile[relative(project.config.root, file).replaceAll('\\', '/')] ??
      [],
  );
  const owned = await provisionDatabaseResources(
    process.env.ANTICA_TEST_DATABASE_URL ?? '',
    slots,
  );
  try {
    project.provide('platformDatabases', owned.resources);
  } catch (cause) {
    try {
      await owned.close();
    } catch (cleanupCause) {
      throw new AggregateError(
        [cause, cleanupCause],
        'Database context publication and cleanup failed',
      );
    }
    throw cause;
  }

  return owned.close;
}
