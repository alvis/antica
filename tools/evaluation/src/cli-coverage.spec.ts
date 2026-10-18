import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serialize } from 'node:v8';

import { expect, it, vi } from 'vitest';
import { z } from 'zod';

import {
  archiveEntry,
  readActiveOwner,
  readVerifiedReceipt,
  snapshotParent,
  appendChild,
  runEntry,
} from '../test/cli-coverage/parent.mjs';
import {
  decodeOwnerWire,
  encodeOwnerWire,
} from '../test/cli-coverage/wire.mjs';
import {
  encodeTsconfigValue,
  invocationSchema,
  readInstrumentationSettings,
  readOwnerSnapshot,
} from '../test/cli-coverage-global-setup.mjs';

import { parseEvaluationArguments } from './cli.js';

let retained: Awaited<ReturnType<typeof snapshotParent>> | undefined;

/**
 * proves semantic parser output and continued increments on retained identities
 * @param previous reference proof from the preceding phase in this worker
 * @returns current live references after executing the public parser
 */
async function exerciseParent(
  previous?: Awaited<ReturnType<typeof snapshotParent>>,
): Promise<Awaited<ReturnType<typeof snapshotParent>>> {
  const before = await snapshotParent();
  if (previous) {
    expect(before.store).toBe(previous.store);
    for (const old of previous.entries) {
      const current = before.entries.find(({ path }) => path === old.path);
      old.refs.forEach((ref, index) => expect(current?.refs[index]).toBe(ref));
      const values = current?.metrics.flat();
      old.metrics
        .flat()
        .forEach((value, index) =>
          expect(values?.[index]).toBeGreaterThanOrEqual(value),
        );
    }
  }
  expect(
    parseEvaluationArguments(['--limit', '7'], 'consumer.json'),
  ).toMatchObject({ limit: 7, output: 'consumer.json', help: false });
  const after = await snapshotParent();
  const path = fileURLToPath(new URL('./cli.ts', import.meta.url));
  const first = before.entries.find((entry) => entry.path === path);
  const last = after.entries.find((entry) => entry.path === path);
  for (const metric of [0, 1]) {
    expect(
      last?.metrics[metric]?.some(
        (value, index) => value > (first?.metrics[metric]?.[index] ?? Infinity),
      ),
    ).toBe(true);
  }
  const output = process.env.ANTICA_CLI_EVIDENCE;
  if (output) {
    await writeFile(
      join(output, `parent-${randomUUID()}.json`),
      JSON.stringify({
        pid: process.pid,
        before,
        after,
      }),
    );
  }

  return after;
}

it('should preserve the complete owner and reject schema loss', () => {
  const owner = readActiveOwner();
  owner.project.mode.extra = { absent: {}, own: undefined, none: null };
  owner.project.vite.configFile = undefined;
  const wire = JSON.parse(JSON.stringify(encodeOwnerWire(owner)));
  expect(readOwnerSnapshot(decodeOwnerWire(wire))).toStrictEqual(owner);
  delete owner.project.vite.configFile;
  expect(
    readOwnerSnapshot(decodeOwnerWire(encodeOwnerWire(owner))),
  ).toStrictEqual(owner);
  const changed = {
    ...owner,
    project: { ...owner.project, unexpected: true },
  };
  expect(() => readOwnerSnapshot(changed)).toThrow('schema changed snapshot');
  expect(() => readOwnerSnapshot({ ...owner, revision: 1 })).toThrow(
    'missing or malformed publication',
  );
  expect(() =>
    readOwnerSnapshot({ ...owner, helperUrl: 'file:///wrong.mts' }),
  ).toThrow('unexpected helper identity');
  const root = {
    ...owner.root,
    mode: { ...owner.root.mode, enabled: !owner.project.mode.enabled },
  };
  expect(() => readOwnerSnapshot({ ...owner, root })).toThrow(
    'mode disagreement',
  );
});

it('should preserve recursive data and sparse numeric values', () => {
  const sparse = Array<unknown>(2);
  sparse[1] = undefined;
  const data = {
    absent: {},
    own: { value: undefined },
    none: null,
    mode: { customProviderModule: undefined, htmlDir: undefined },
    configFile: undefined,
    sparse,
    numbers: [-0, Number.NaN, Infinity, -Infinity],
    integer: 7n,
  };
  expect(
    decodeOwnerWire(JSON.parse(JSON.stringify(encodeOwnerWire(data)))),
  ).toStrictEqual(data);
  const cycle: { self?: unknown } = {};
  cycle.self = cycle;
  expect(decodeOwnerWire(encodeOwnerWire(cycle))).toStrictEqual(cycle);
});

it('should reject nondata without executing property accessors', () => {
  const getter = vi.fn(() => null);
  const accessor = Object.defineProperty({}, 'value', {
    get: getter,
    enumerable: true,
  });
  for (const value of [
    accessor,
    () => undefined,
    Symbol('value'),
    new Date(),
    new Map(),
    new Set(),
    new Uint8Array(1),
    Object.create(null),
    Object.create({ inherited: true }),
    Object.defineProperty({}, 'hidden', { value: 1 }),
    { [Symbol('key')]: 1 },
  ]) {
    expect(() => encodeOwnerWire(value)).toThrow('Unsupported owner wire');
  }
  expect(getter).not.toHaveBeenCalled();
  const wire = {
    format: 'antica-cli-owner-v3/v8-base64',
    data: serialize(new Date()).toString('base64'),
  };
  expect(() => decodeOwnerWire(wire)).toThrow('Unsupported owner wire');
});

it('should reject malformed envelopes before owner consumption', () => {
  const wire = encodeOwnerWire(readActiveOwner());
  for (const bad of [
    undefined,
    {},
    { ...wire, format: 'old' },
    { ...wire, data: '' },
    { ...wire, data: 'invalid!' },
    { ...wire, data: 'AA==' },
    { ...wire, extra: true },
  ]) {
    expect(() => decodeOwnerWire(bad)).toThrow();
  }
  expect(() => readOwnerSnapshot(decodeOwnerWire(encodeOwnerWire(1)))).toThrow(
    'missing or malformed publication',
  );
});

it('should preserve tsconfig observations and reject lossy messages', () => {
  const owner = readActiveOwner();
  expect(owner.project.vite.tsconfig.present).toBe(true);
  const message = {
    sourceUrl: import.meta.url,
    sourceHash: createHash('sha256').update('wire fixture').digest('hex'),
    output: tmpdir(),
    token: randomUUID(),
  };
  for (const [value, expected] of [
    [undefined, { kind: 'undefined' }],
    [null, { kind: 'value', value: null }],
    ['', { kind: 'value', value: '' }],
    ['tsconfig.cli.json', { kind: 'value', value: 'tsconfig.cli.json' }],
  ]) {
    for (const present of [false, true]) {
      const encoded = encodeTsconfigValue(value);
      owner.project.vite.tsconfig = { present, value: encoded };
      const wire = invocationSchema.parse(
        JSON.parse(
          JSON.stringify({ ...message, owner: encodeOwnerWire(owner) }),
        ),
      );
      const decoded = decodeOwnerWire(wire.owner);
      expect(decoded).toStrictEqual(owner);
      expect(owner.project.vite.tsconfig).toStrictEqual({
        present,
        value: expected,
      });
      const options = () =>
        readInstrumentationSettings(readOwnerSnapshot(decoded));
      if (value === undefined) {
        expect(options()).toEqual(owner.project.vite.oxc);
      } else {
        expect(options).toThrow('unsupported active transform route');
      }
    }
  }
  expect(() => encodeTsconfigValue(1)).toThrow(z.ZodError);
});

it('should reject incomplete inner tags without reconstructing fields', () => {
  const owner = readActiveOwner();
  for (const bad of [
    null,
    undefined,
    {},
    { kind: 'value' },
    { kind: 'bad' },
    { kind: 'undefined', value: null },
  ]) {
    const vite = {
      ...owner.project.vite,
      tsconfig: { present: true, value: bad },
    };
    const broken = { ...owner, project: { ...owner.project, vite } };
    expect(() =>
      readOwnerSnapshot(decodeOwnerWire(encodeOwnerWire(broken))),
    ).toThrow('missing or malformed publication');
  }
});

it.each([
  'main.ts',
  'retrieval-main.ts',
  'sensitivity-main.ts',
  'editing-main.ts',
])('should preserve the real invalid-option failure for %s', async (entry) => {
  const sourceUrl = new URL(`./${entry}`, import.meta.url);
  const directory = await mkdtemp(join(tmpdir(), 'antica-owner-cli-'));
  try {
    const mode = readActiveOwner().project.mode;
    if (mode.enabled && mode.provider === 'istanbul') {
      retained = await exerciseParent(retained);
    }
    const launch = await runEntry(sourceUrl, directory);
    const { result } = launch;
    expect(result.error).toBeUndefined();
    expect(result.signal).toBeNull();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Unknown option');
    expect(result.stdout).toBe('');
    const receipt = await readVerifiedReceipt(launch);
    if (mode.enabled && mode.provider === 'istanbul') {
      const consumed = new Set<string>();
      for (const changed of [
        { field: 'pid', value: result.pid + 1, message: 'PID mismatch' },
        { field: 'token', value: randomUUID(), message: 'token mismatch' },
        {
          field: 'sourceUrl',
          value: 'file:///x',
          message: 'source mismatch',
        },
      ]) {
        await expect(
          appendChild(
            launch,
            { ...receipt, [changed.field]: changed.value },
            consumed,
          ),
        ).rejects.toThrow(changed.message);
      }
      await appendChild(launch, receipt, consumed);
      await expect(appendChild(launch, receipt, consumed)).rejects.toThrow(
        'already consumed',
      );
      retained = await exerciseParent(retained);
    }
  } finally {
    await archiveEntry(directory, sourceUrl);
  }
});

it('should keep parent increments live in a later test in the same worker', async () => {
  const mode = readActiveOwner().project.mode;
  if (mode.enabled && mode.provider === 'istanbul') {
    expect(retained).toBeDefined();
    retained = await exerciseParent(retained);
  }
});
