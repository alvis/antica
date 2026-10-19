import { encodeOwnerWire, ownerWireSchema } from '#cli-coverage/wire';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

import { version } from 'vitest/node';
import { z } from 'zod';

import type { CliCoverageOwnerWire } from '#cli-coverage/wire';
import type { ResolvedConfig } from 'vite';
import type { TestProject } from 'vitest/node';

const instrumentedOxcSchema = z.strictObject({
  target: z.literal('node18'),
  jsx: z.strictObject({ development: z.literal(true) }),
});

const modeSchema = z.looseObject({
  enabled: z.boolean(),
  provider: z.string(),
});
const tsconfigValueSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('undefined') }),
  z.strictObject({ kind: z.literal('value'), value: z.string().nullable() }),
]);
const viteSchema = z.object({
  command: z.string(),
  mode: z.string(),
  configFile: z.string().optional(),
  tsconfig: z.strictObject({
    present: z.boolean(),
    value: tsconfigValueSchema,
  }),
  oxc: z.unknown(),
  environments: z.record(
    z.string(),
    z.object({
      consumer: z.string(),
      isBundled: z.boolean(),
    }),
  ),
});
const coverageSchema = z.object({
  ignoreClassMethods: z.unknown(),
  customInstrumenter: z.boolean(),
});
const ownerSnapshotSchema = z.strictObject({
  revision: z.literal(2),
  publication: z.uuid(),
  helperUrl: z.url(),
  version: z.string(),
  project: z.object({
    name: z.string(),
    root: z.string(),
    mode: modeSchema,
    coverage: coverageSchema,
    vite: viteSchema,
    globalSetup: z.array(z.string()),
  }),
  root: z.object({
    name: z.string(),
    root: z.string(),
    mode: modeSchema,
    coverage: coverageSchema,
    vite: viteSchema,
    globalSetup: z.array(z.string()),
  }),
  peers: z.array(
    z.object({
      name: z.string(),
      root: z.string(),
      globalSetup: z.array(z.string()),
    }),
  ),
});

/** actual validated owner observation transported through Vitest */
export type CliCoverageOwnerSnapshot = z.infer<typeof ownerSnapshotSchema>;

declare module 'vitest' {
  interface ProvidedContext {
    anticaCliCoverageOwner: CliCoverageOwnerWire;
  }
}

export const invocationSchema = z.strictObject({
  owner: ownerWireSchema,
  sourceUrl: z.url(),
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
  output: z.string().min(1),
  token: z.uuid(),
});

/**
 * validates the published active owner before selecting any execution mode
 * @param value actual injected or forwarded publication
 * @returns the validated owner observation
 */
export function readOwnerSnapshot(value: unknown): CliCoverageOwnerSnapshot {
  const result = ownerSnapshotSchema.safeParse(value);
  if (!result.success) {
    throw new Error(
      'CLI owner-settings integration: missing or malformed publication',
      { cause: result.error },
    );
  }
  const snapshot = result.data;
  if (!isDeepStrictEqual(snapshot, value)) {
    throw new Error('CLI owner-settings integration: schema changed snapshot');
  }
  if (snapshot.helperUrl !== import.meta.url) {
    throw new Error(
      'CLI owner-settings integration: unexpected helper identity',
    );
  }
  if (
    snapshot.project.mode.enabled !== snapshot.root.mode.enabled ||
    snapshot.project.mode.provider !== snapshot.root.mode.provider
  ) {
    throw new Error(
      'CLI owner-settings integration: root/project mode disagreement',
    );
  }
  if (
    snapshot.project.mode.enabled &&
    snapshot.project.mode.provider === 'istanbul'
  ) {
    readInstrumentationSettings(snapshot);
  }

  return snapshot;
}

/**
 * rejects transform routes outside this bounded public Oxc candidate
 * @param snapshot current actual owner observation
 * @returns strictly observed supported Oxc options
 */
export function readInstrumentationSettings(
  snapshot: CliCoverageOwnerSnapshot,
): z.infer<typeof instrumentedOxcSchema> {
  const oxc = instrumentedOxcSchema.parse(snapshot.project.vite.oxc);
  const { vite } = snapshot.project;
  if (
    vite.command !== 'serve' ||
    vite.mode !== 'test' ||
    vite.tsconfig.value.kind !== 'undefined' ||
    vite.environments.ssr?.isBundled !== false ||
    vite.environments.ssr.consumer !== 'server' ||
    snapshot.root.coverage.customInstrumenter
  ) {
    throw new Error(
      'CLI owner-settings integration: unsupported active transform route',
    );
  }
  z.tuple([]).parse(snapshot.root.coverage.ignoreClassMethods);

  return oxc;
}

/**
 * preserves the observed tsconfig value across the JSON boundary
 * @param value actual resolved property value
 * @returns an explicit undefined tag or unchanged string or null
 */
export function encodeTsconfigValue(
  value: unknown,
): CliCoverageOwnerSnapshot['project']['vite']['tsconfig']['value'] {
  if (value === undefined) {
    return { kind: 'undefined' };
  }

  return { kind: 'value', value: z.string().nullable().parse(value) };
}

/**
 * records resolved Vite values without replacing absence with defaults
 * @param config actual active server configuration
 * @returns plain observations for publication
 */
function observeVite(
  config: ResolvedConfig,
): CliCoverageOwnerSnapshot['project']['vite'] {
  return {
    command: config.command,
    mode: config.mode,
    configFile: config.configFile,
    tsconfig: {
      present: Object.hasOwn(config, 'tsconfig'),
      value: encodeTsconfigValue(config.tsconfig),
    },
    oxc: config.oxc,
    environments: Object.fromEntries(
      Object.entries(config.environments).map(([name, environment]) => [
        name,
        {
          consumer: environment.consumer,
          isBundled: environment.isBundled,
        },
      ]),
    ),
  };
}

/**
 * captures the active project and collector without starting another instance
 * @param project actual setup owner
 * @returns cloneable current owner observation
 */
function observeProject(project: TestProject): {
  name: TestProject['name'];
  root: TestProject['config']['root'];
  mode: TestProject['serializedConfig']['coverage'];
  coverage: ReturnType<typeof observeCoverage>;
  vite: ReturnType<typeof observeVite>;
  globalSetup: TestProject['config']['globalSetup'];
} {
  return {
    name: project.name,
    root: project.config.root,
    mode: project.serializedConfig.coverage,
    coverage: observeCoverage(project.config.coverage),
    vite: observeVite(project.vite.config),
    globalSetup: project.config.globalSetup,
  };
}

/**
 * records collector settings without serializing a custom implementation
 * @param coverage active resolved collector configuration
 * @returns observed instrumenter options
 */
function observeCoverage(
  coverage: TestProject['config']['coverage'],
): CliCoverageOwnerSnapshot['root']['coverage'] {
  return {
    ignoreClassMethods:
      'ignoreClassMethods' in coverage
        ? coverage.ignoreClassMethods
        : undefined,
    customInstrumenter:
      'instrumenter' in coverage && coverage.instrumenter !== undefined,
  };
}

/**
 * publishes current public project settings before the worker starts
 * @param project actual TestProject supplied by Vitest
 */
export default function setup(project: TestProject): void {
  const publish = (): void => {
    const snapshot = readOwnerSnapshot({
      revision: 2,
      publication: randomUUID(),
      helperUrl: import.meta.url,
      version,
      project: observeProject(project),
      root: {
        ...observeProject(project.vitest.getRootProject()),
        coverage: observeCoverage(project.vitest.config.coverage),
        vite: observeVite(project.vitest.vite.config),
      },
      peers: project.vitest.projects.map((peer) => ({
        name: peer.name,
        root: peer.config.root,
        globalSetup: peer.config.globalSetup,
      })),
    });
    const wire = encodeOwnerWire(snapshot);
    console.warn('CLI_OWNER_PUBLICATION', JSON.stringify(wire));
    project.provide('anticaCliCoverageOwner', wire);
  };
  publish();
  project.onTestsRerun(publish);
}
