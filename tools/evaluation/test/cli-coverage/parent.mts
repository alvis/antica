import { readOwnerSnapshot } from '../cli-coverage-global-setup.mjs';
import { countersSchema, childSchema } from '../cli-coverage-loader.mjs';
import { decodeOwnerWire, encodeOwnerWire, ownerWireSchema } from './wire.mjs';
import coverage from '@vitest/coverage-istanbul';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { cp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { inject } from 'vitest';
import { z } from 'zod';

import type { invocationSchema } from '../cli-coverage-global-setup.mjs';
import type { ParentSnapshot, RunEntryResult } from './contracts.mjs';

/**
 * reads only the current owner's public publication
 * @returns the complete consumed owner observation
 */
export function readActiveOwner(): ReturnType<typeof readOwnerSnapshot> {
  const wire: unknown = inject('anticaCliCoverageOwner');
  if (wire === undefined) {
    throw new Error(
      'CLI owner-settings integration: missing or malformed publication',
    );
  }

  return readOwnerSnapshot(decodeOwnerWire(wire));
}

/**
 * runs one original native entry with a complete owner transport
 * @param sourceUrl unchanged original TypeScript entry URL
 * @param directory isolated child working directory
 * @returns actual child outcome, invocation and retained in-memory owner
 */
export async function runEntry(
  sourceUrl: URL,
  directory: string,
): Promise<RunEntryResult> {
  const owner = readActiveOwner();
  const source = await readFile(sourceUrl);
  const invocation = {
    owner: encodeOwnerWire(owner),
    sourceUrl: sourceUrl.href,
    sourceHash: createHash('sha256').update(source).digest('hex'),
    token: randomUUID(),
    output: join(directory, 'entry'),
  };
  const input = join(directory, 'invocation.json');
  await writeFile(input, JSON.stringify(invocation));
  const argv = [
    '--import',
    pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href,
    '--import',
    new URL('../cli-coverage-preload.mts', import.meta.url).href,
    fileURLToPath(sourceUrl),
    '--unknown-option',
  ];
  const start = new Date().toISOString();
  const result = spawnSync(process.execPath, argv, {
    cwd: directory,
    encoding: 'utf8',
    env: { ...process.env, ANTICA_CLI_INVOCATION: input },
  });
  await writeFile(
    join(directory, 'child.json'),
    JSON.stringify({
      argv: [process.execPath, ...argv],
      cwd: directory,
      start,
      end: new Date().toISOString(),
      result,
      publicStorePresent: (await coverage.takeCoverage?.()) !== undefined,
    }),
  );

  return { result, invocation, owner };
}

const artifactSchema = z.looseObject({
  owner: ownerWireSchema,
  token: z.uuid(),
});

/**
 * reads an actual native artifact without discarding its additional fields
 * @param path invocation-bound artifact path
 * @returns validated identity and complete owner envelope
 */
export async function readArtifact(
  path: string,
): Promise<z.infer<typeof artifactSchema>> {
  const raw: unknown = JSON.parse(await readFile(path, 'utf8'));

  return artifactSchema.parse(raw);
}

/**
 * archives every outcome before removing its temporary working directory
 * @param directory isolated child working directory
 * @param sourceUrl original entry used for the archive name
 */
export async function archiveEntry(
  directory: string,
  sourceUrl: URL,
): Promise<void> {
  const evidence = process.env.ANTICA_CLI_EVIDENCE;
  if (evidence) {
    const destination = join(
      evidence,
      `${basename(sourceUrl.pathname)}-${randomUUID()}`,
    );
    await cp(directory, destination, { recursive: true });
  }
  await rm(directory, { recursive: true, force: true });
}

/**
 * captures genuine current references separately from numeric snapshots
 * @returns live object identities and copied counts in the current worker
 */
export async function snapshotParent(): Promise<ParentSnapshot> {
  const store = await coverage.takeCoverage?.();
  const parsed = z.record(z.string(), countersSchema).safeParse(store);
  if (!parsed.success || Object.keys(parsed.data).length === 0) {
    throw new Error(
      'CLI owner-settings integration: enabled Istanbul store missing or malformed',
    );
  }
  assert(typeof store === 'object' && store !== null);

  return {
    store,
    entries: Object.entries(parsed.data).map(([path, data]) => {
      const file: unknown = Reflect.get(store, path);
      assert(typeof file === 'object' && file !== null);
      const refs: unknown[] = [
        file,
        ...['s', 'f', 'b'].map((key) => Reflect.get(file, key)),
      ];

      return {
        path,
        refs,
        metrics: [
          Object.values(data.s),
          Object.values(data.f),
          Object.values(data.b).flat(),
        ],
      };
    }),
  };
}

/**
 * binds one consumed receipt to its actual launch and complete parent owner
 * @param receipt received native identity and counters
 * @param launch actual process outcome and invocation
 */
function validateReceipt(
  receipt: z.infer<typeof artifactSchema>,
  launch: Awaited<ReturnType<typeof runEntry>>,
): void {
  const { invocation, result, owner } = launch;
  const { token, sourceUrl, sourceHash, output } = invocation;
  assert.equal(receipt.pid, result.pid, 'CLI receipt PID mismatch');
  assert.equal(receipt.token, token, 'CLI receipt token mismatch');
  assert.equal(receipt.sourceUrl, sourceUrl, 'CLI receipt source mismatch');
  assert.equal(receipt.sourceHash, sourceHash, 'CLI receipt hash mismatch');
  assert.equal(receipt.status, result.status);
  assert.equal(receipt.cwd, realpathSync(dirname(output)));
  assert.deepEqual(readOwnerSnapshot(decodeOwnerWire(receipt.owner)), owner);
  assert(result.pid > 0);
  assert.notEqual(token, owner.publication);
}

/**
 * validates the receipt and real hook observations in the active mode
 * @param launch actual child and retained in-memory owner
 * @returns the complete authenticated receipt
 */
export async function readVerifiedReceipt(
  launch: Awaited<ReturnType<typeof runEntry>>,
): Promise<z.infer<typeof artifactSchema>> {
  const { invocation, result, owner } = launch;
  const receipt = await readArtifact(`${invocation.output}.receipt.json`);
  validateReceipt(receipt, launch);
  if (
    owner.project.mode.enabled &&
    owner.project.mode.provider === 'istanbul'
  ) {
    for (const suffix of ['loader-initialized', 'before-transform']) {
      const hook = await readArtifact(`${invocation.output}.${suffix}.json`);
      assert.equal(hook.pid, result.pid);
      assert.equal(hook.token, invocation.token);
      assert.deepEqual(readOwnerSnapshot(decodeOwnerWire(hook.owner)), owner);
      assert.equal(hook.sourceUrl ?? hook.url, invocation.sourceUrl);
    }
  }

  return receipt;
}

/**
 * validates every emitted map against the genuine pre-execution instrumenter data
 * @param receipt actual native counters, never filtered
 * @param invocation original source and artifact binding
 * @returns the complete child-only map with unchanged geometry and counters
 */
async function readChildMap(
  receipt: z.infer<typeof artifactSchema>,
  invocation: z.infer<typeof invocationSchema>,
): Promise<Record<string, z.infer<typeof childSchema>>> {
  const child = z.record(z.string(), childSchema).parse(receipt.coverage);
  assert.deepEqual(child, receipt.coverage, 'CLI child schema changed data');
  const path = fileURLToPath(invocation.sourceUrl);
  assert.deepEqual(
    Object.keys(child),
    [`${path}.child.js`],
    'Unexpected CLI counter path',
  );
  const entry = child[`${path}.child.js`];
  assert(entry);
  const original = await readFile(new URL(invocation.sourceUrl), 'utf8');
  assert.equal(
    createHash('sha256').update(original).digest('hex'),
    invocation.sourceHash,
  );
  assert.equal(entry.path, `${path}.child.js`);
  assert.deepEqual(entry.inputSourceMap.sources, [path]);
  assert.deepEqual(entry.inputSourceMap.sourcesContent, [original]);
  const template = childSchema.parse(
    JSON.parse(await readFile(`${invocation.output}.geometry.json`, 'utf8')),
  );
  for (const key of Object.keys(template)) {
    if (['s', 'f', 'b'].includes(key)) {
      const record = z.record(z.string(), z.unknown());
      assert.deepEqual(
        Object.keys(record.parse(entry[key])),
        Object.keys(record.parse(template[key])),
      );
    } else {
      assert.deepEqual(
        entry[key],
        template[key],
        `CLI geometry changed: ${key}`,
      );
    }
  }
  for (const [id, hits] of Object.entries(entry.b)) {
    assert.equal(
      hits.length,
      template.b[id]?.length,
      'CLI branch arity changed',
    );
  }

  return child;
}

/**
 * appends only a validated disjoint child map into the fresh public store
 * @param launch genuine child invocation and retained owner
 * @param receipt actual exit artifact, including authentic counters
 * @param consumed tokens owned by this test phase
 */
export async function appendChild(
  launch: Awaited<ReturnType<typeof runEntry>>,
  receipt: z.infer<typeof artifactSchema>,
  consumed: Set<string>,
): Promise<void> {
  validateReceipt(receipt, launch);
  assert(!consumed.has(receipt.token), 'CLI receipt already consumed');
  const child = await readChildMap(receipt, launch.invocation);
  const { store } = await snapshotParent();
  for (const path of Object.keys(child)) {
    assert(
      !Object.hasOwn(store, path),
      'CLI child collision with existing store',
    );
  }
  for (const [path, entry] of Object.entries(child)) {
    Reflect.set(store, path, entry);
  }
  consumed.add(receipt.token);
}
