import { describe, expect, it, vi } from 'vitest';

import { provisionHttpResources } from './http/resources.js';
import setup from './http-global-setup.js';

import type { TestProject, TestSpecification } from 'vitest/node';

import type { ProvisionedHttpResources } from './http/resources.js';

const boundary = vi.hoisted(() => ({
  close: vi.fn<ProvisionedHttpResources['close']>(async () => {}),
  resources: {
    webhook: {
      databaseUrl: 'postgres://localhost/antica_setup_test',
      directory: '/private/test-owned-setup',
      inbox: '/private/test-owned-setup/otp',
      storageRoot: '/private/test-owned-setup/objects',
    },
  },
}));

vi.mock(
  './http/resources.js',
  () =>
    ({
      provisionHttpResources: vi.fn<typeof provisionHttpResources>(
        async () => ({
          resources: boundary.resources,
          close: boundary.close,
        }),
      ),
    }) satisfies Partial<typeof import('./http/resources.js')>,
);

const projectRoot = '/private/api-test-project';
const databaseUrl = 'postgresql://localhost/antica_test_harness';

/**
 * provides the runner's selected paths and project identities without a live run
 * @param files selected paths across all projects in this run
 * @param foreignFiles paths whose specifications belong to another project
 * @returns the project and its observable runner boundaries
 */
function createProject(
  files: string[] = [`${projectRoot}/src/webhook.spec.int.ts`],
  foreignFiles: string[] = [],
): {
  project: TestProject;
  provide: TestProject['provide'];
  getPaths: TestProject['vitest']['state']['getPaths'];
  globTestFiles: TestProject['globTestFiles'];
} {
  const config = { root: projectRoot } satisfies Partial<TestProject['config']>;
  const foreign = {} satisfies Partial<TestProject>;
  const state = {
    getPaths: vi.fn(() => files),
  } satisfies Partial<TestProject['vitest']['state']>;
  const vitest = {
    state: state as Partial<
      TestProject['vitest']['state']
    > as TestProject['vitest']['state'],
    getModuleSpecifications: vi.fn((file: string) => {
      const specification = {
        project: foreignFiles.includes(file)
          ? (foreign as Partial<TestProject> as TestProject)
          : project,
      } satisfies Partial<TestSpecification>;

      return [specification as Partial<TestSpecification> as TestSpecification];
    }),
  } satisfies Partial<TestProject['vitest']>;
  const partialProject = {
    config: config as Partial<TestProject['config']> as TestProject['config'],
    vitest: vitest as Partial<TestProject['vitest']> as TestProject['vitest'],
    provide: vi.fn<TestProject['provide']>(),
    globTestFiles: vi.fn<TestProject['globTestFiles']>(async () => ({
      testFiles: [`${projectRoot}/src/source-providers.spec.int.ts`],
      typecheckTestFiles: [],
    })),
  } satisfies Partial<TestProject>;
  const project = partialProject as Partial<TestProject> as TestProject;

  return {
    project,
    provide: partialProject.provide,
    getPaths: state.getPaths,
    globTestFiles: partialProject.globTestFiles,
  };
}

describe('fn:HTTP global setup', () => {
  it('should provision only selected API suites and isolated webhook slots', async () => {
    const foreignFile = `${projectRoot}/src/cloud-source.spec.int.ts`;
    const { project, provide, globTestFiles } = createProject(
      [
        `${projectRoot}/src/webhook.spec.int.ts`,
        `${projectRoot}/src/cloud-jobs.spec.int.ts`,
        `${projectRoot}/src\\routes\\analysis.spec.int.tsx`,
        `${projectRoot}/src/application.spec.ts`,
        `${projectRoot}/src/acceptance/custom.spec.int.ts`,
        foreignFile,
      ],
      [foreignFile],
    );
    vi.stubEnv('ANTICA_TEST_DATABASE_URL', databaseUrl);

    const teardown = await setup(project);

    expect(vi.mocked(provisionHttpResources).mock.calls).toEqual([
      [
        databaseUrl,
        [
          'webhook',
          'webhook-race',
          'webhook-closed',
          'cloud-jobs',
          'routes/analysis',
        ],
      ],
    ]);
    expect(vi.mocked(globTestFiles).mock.calls).toEqual([]);
    expect(vi.mocked(provide).mock.calls).toEqual([
      ['httpResources', boundary.resources],
    ]);
    expect(boundary.close.mock.calls).toEqual([]);
    expect(teardown).toBe(boundary.close);
    await teardown();
    expect(boundary.close.mock.calls).toEqual([[]]);
  });

  it('should leave an empty selection empty and delegate absent URL validation', async () => {
    const { project } = createProject([]);
    vi.stubEnv('ANTICA_TEST_DATABASE_URL', undefined);

    await setup(project);

    expect(vi.mocked(provisionHttpResources).mock.calls).toEqual([['', []]]);
  });

  it('should propagate selection failure before provisioning', async () => {
    const { project, getPaths, provide } = createProject();
    const failure = new Error('runner state unavailable');
    vi.mocked(getPaths).mockImplementationOnce(() => {
      throw failure;
    });

    await expect(setup(project)).rejects.toBe(failure);
    expect(vi.mocked(provisionHttpResources).mock.calls).toEqual([]);
    expect(vi.mocked(provide).mock.calls).toEqual([]);
    expect(boundary.close.mock.calls).toEqual([]);
  });

  it('should propagate acquisition failure without publishing resources', async () => {
    const { project, provide } = createProject();
    const failure = new Error('provisioning failed');
    vi.mocked(provisionHttpResources).mockRejectedValueOnce(failure);

    await expect(setup(project)).rejects.toBe(failure);
    expect(vi.mocked(provide).mock.calls).toEqual([]);
    expect(boundary.close.mock.calls).toEqual([]);
  });

  it('should await cleanup and retain a publication failure', async () => {
    const { project, provide } = createProject();
    const failure = new Error('runner publication failed');
    const events: string[] = [];
    vi.mocked(provide).mockImplementationOnce(() => {
      throw failure;
    });
    boundary.close.mockImplementationOnce(async () => {
      await Promise.resolve();
      events.push('closed');
    });

    await expect(setup(project)).rejects.toBe(failure);
    expect(events).toEqual(['closed']);
    expect(boundary.close.mock.calls).toEqual([[]]);
  });

  it('should retain publication and nested disposal failures in order', async () => {
    const { project, provide } = createProject();
    const failure = new Error('runner publication failed');
    const dropFailure = new Error('database drop failed');
    const closeFailure = new Error('admin pool close failed');
    const cleanupFailure = new SuppressedError(closeFailure, dropFailure);
    vi.mocked(provide).mockImplementationOnce(() => {
      throw failure;
    });
    boundary.close.mockRejectedValueOnce(cleanupFailure);

    await expect(setup(project)).rejects.toMatchObject({
      name: 'AggregateError',
      errors: [
        failure,
        {
          name: 'SuppressedError',
          error: closeFailure,
          suppressed: dropFailure,
        },
      ],
    });
    expect(boundary.close.mock.calls).toEqual([[]]);
  });

  it('should expose teardown failures to the runner', async () => {
    const { project } = createProject();
    const failure = new Error('resource disposal failed');
    const teardown = await setup(project);
    boundary.close.mockRejectedValueOnce(failure);

    await expect(teardown()).rejects.toBe(failure);
    expect(boundary.close.mock.calls).toEqual([[]]);
  });
});
