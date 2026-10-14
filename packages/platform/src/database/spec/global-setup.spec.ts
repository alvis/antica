import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { setup } from './global-setup.js';
import { provisionDatabaseResources } from './resources.js';

import type { TestProject } from 'vitest/node';

const boundary = vi.hoisted(() => ({
  close: vi.fn<() => Promise<void>>(async () => {}),
  resources: { commands: { url: 'postgres://localhost/owned_commands' } },
}));

vi.mock(
  './resources.js',
  () =>
    ({
      provisionDatabaseResources: vi.fn<typeof provisionDatabaseResources>(
        async () => ({
          resources: boundary.resources,
          close: boundary.close,
        }),
      ),
    }) satisfies Partial<typeof import('./resources.js')>,
);

const projectRoot = '/private/test-platform';

describe('fn:setup', () => {
  it('should preserve the publication error after successfully releasing acquired resources', async () => {
    const publication = new Error('Publication unavailable');
    const project = createProject([
      'src/database/schema/constraints.spec.int.ts',
    ]);
    vi.mocked(project.provide).mockImplementationOnce(() => {
      throw publication;
    });

    await expect(setup(project)).rejects.toBe(publication);

    expect(boundary.close).toHaveBeenCalledTimes(1);
  });

  it('should close acquired resources when publication fails and retain both failures if cleanup fails', async () => {
    vi.stubEnv('ANTICA_TEST_DATABASE_URL', undefined);
    const publication = new Error('Publication failed');
    const cleanup = new Error('Cleanup failed');
    const project = createProject([]);
    vi.mocked(project.provide).mockImplementationOnce(() => {
      throw publication;
    });
    boundary.close.mockRejectedValueOnce(cleanup);

    await expect(setup(project)).rejects.toMatchObject({
      errors: [publication, cleanup],
    });

    expect(boundary.close).toHaveBeenCalledTimes(1);
    expect(vi.mocked(provisionDatabaseResources).mock.calls).toEqual([
      ['', []],
    ]);
  });

  it('should provision only initial selected files belonging to this project and publish their handles', async () => {
    vi.stubEnv('ANTICA_TEST_DATABASE_URL', 'postgres://localhost/antica_test');
    const project = createProject(
      [
        'src/database/commands.spec.int.ts',
        'src/database/schema/generated.spec.int.ts',
        'src/database/repositories/evidence-create.spec.int.ts',
        'src/database/unmapped.spec.int.ts',
        'src/database/schema/constraints.spec.int.ts',
      ],
      'src/database/schema/constraints.spec.int.ts',
    );

    const teardown = await setup(project);

    expect(vi.mocked(provisionDatabaseResources).mock.calls).toEqual([
      [
        'postgres://localhost/antica_test',
        [
          { id: 'commands', migrate: true },
          { id: 'generated', migrate: false },
          { id: 'upgrade', migrate: false },
          { id: 'backfill', migrate: false },
          { id: 'evidence-create', migrate: true },
        ],
      ],
    ]);
    expect(vi.mocked(project.provide).mock.calls).toEqual([
      ['platformDatabases', boundary.resources],
    ]);
    expect(project.globTestFiles).not.toHaveBeenCalled();
    expect(boundary.close).not.toHaveBeenCalled();

    await teardown();

    expect(boundary.close).toHaveBeenCalledTimes(1);
  });
});

function createProject(
  selected: readonly string[],
  foreign?: string,
): TestProject {
  const project: TestProject = {
    config: { root: projectRoot } satisfies Partial<
      TestProject['config']
    > as Partial<TestProject['config']> as TestProject['config'],
    provide: vi.fn<TestProject['provide']>(),
    globTestFiles: vi.fn(async () => ({
      testFiles: [
        join(projectRoot, 'src/database/repositories/sources.spec.int.ts'),
      ],
      typecheckTestFiles: [],
    })),
    vitest: {
      state: {
        getPaths: () => selected.map((file) => join(projectRoot, file)),
      } satisfies Partial<TestProject['vitest']['state']> as Partial<
        TestProject['vitest']['state']
      > as TestProject['vitest']['state'],
      getModuleSpecifications: (file: string) =>
        [
          {
            project:
              file === join(projectRoot, foreign ?? '')
                ? ({} satisfies Partial<TestProject> as Partial<TestProject> as TestProject)
                : project,
          },
        ] satisfies Array<
          Partial<
            ReturnType<TestProject['vitest']['getModuleSpecifications']>[number]
          >
        > as Array<
          Partial<
            ReturnType<TestProject['vitest']['getModuleSpecifications']>[number]
          >
        > as ReturnType<TestProject['vitest']['getModuleSpecifications']>,
    } satisfies Partial<TestProject['vitest']> as Partial<
      TestProject['vitest']
    > as TestProject['vitest'],
  } satisfies Partial<TestProject> as Partial<TestProject> as TestProject;

  return project;
}
