// runs in Node's module-hooks thread, where tsx does not apply, so imports use #cli-coverage/*
import { decodeOwnerWire, encodeOwnerWire } from '#cli-coverage/wire';
import {
  invocationSchema,
  readOwnerSnapshot,
  readInstrumentationSettings,
} from '#cli-coverage/global-setup';
import { createInstrumenter } from 'istanbul-lib-instrument';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { transformWithOxc } from 'vite';

import { z } from 'zod';

import type { LoadHook } from 'node:module';

let invocation: z.infer<typeof invocationSchema> | undefined;

/**
 * binds the original entry and publicly resolved owner settings to one child
 * @param data invocation data passed through the Node registration API
 */
export function initialize(data: unknown): void {
  const parsed = invocationSchema.parse(data);
  const owner = readOwnerSnapshot(decodeOwnerWire(parsed.owner));
  const entries = ['main.ts', 'retrieval-main.ts', 'sensitivity-main.ts'];
  if (
    !entries.some(
      (name) =>
        new URL(`../src/${name}`, import.meta.url).href === parsed.sourceUrl,
    )
  ) {
    throw new Error('Unexpected CLI coverage entry');
  }

  writeFileSync(
    `${parsed.output}.loader-initialized.json`,
    JSON.stringify({
      loaderUrl: import.meta.url,
      pid: process.pid,
      token: parsed.token,
      owner: encodeOwnerWire(owner),
      sourceUrl: parsed.sourceUrl,
    }),
  );
  invocation = parsed;
}

/**
 * creates the working instrumenter from copied public factory defaults
 * @returns an instrumenter retaining the provider's measured parser settings
 */
function createEntryInstrumenter(): ReturnType<typeof createInstrumenter> {
  const defaults = createInstrumenter().opts;
  const defaultParserPlugins: unknown = defaults.parserPlugins;
  if (
    !Array.isArray(defaultParserPlugins) ||
    !defaultParserPlugins.every(
      (plugin: unknown): plugin is string => typeof plugin === 'string',
    )
  ) {
    throw new Error('Locked instrumenter parser defaults changed');
  }
  const options = {
    produceSourceMap: true,
    autoWrap: false,
    esModules: true,
    compact: false,
    coverageVariable: '__coverage__',
    coverageGlobalScope: 'globalThis',
    coverageGlobalScopeFunc: false,
    ignoreClassMethods: [],
    parserPlugins: [
      ...defaultParserPlugins,
      ['importAttributes', { deprecatedAssertSyntax: true }],
    ],
    generatorOpts: {
      ...defaults.generatorOpts,
      importAttributesKeyword: 'with',
    },
  };

  return createInstrumenter(options);
}

/**
 * transforms the original native entry before instrumenting its genuine map
 * @param url native module URL, preserved without entry metadata changes
 * @param context Node loader context
 * @param nextLoad next registered loader for every other module
 * @returns the instrumented module or the next loader's original result
 */
export const load: LoadHook = async (url, context, nextLoad) => {
  if (!invocation) {
    throw new Error('CLI coverage loader was not initialized');
  }
  if (url !== invocation.sourceUrl) {
    return nextLoad(url, context);
  }

  return transformEntry(url, invocation);
};

/**
 * instruments only the bound original native entry and archives raw maps
 * @param url unchanged original TypeScript URL
 * @param invocation validated child invocation
 * @returns genuine instrumented module source
 */
async function transformEntry(
  url: string,
  invocation: z.infer<typeof invocationSchema>,
): Promise<Awaited<ReturnType<LoadHook>>> {
  const path = fileURLToPath(url);
  const source = readFileSync(path, 'utf8');
  const sourceHash = createHash('sha256').update(source).digest('hex');
  if (sourceHash !== invocation.sourceHash) {
    throw new Error(`Original CLI source changed: ${path}`);
  }
  const owner = readOwnerSnapshot(decodeOwnerWire(invocation.owner));
  const instrumenter = createEntryInstrumenter();
  const options: Parameters<typeof transformWithOxc>[2] = {
    ...readInstrumentationSettings(owner),
    lang: 'ts',
    sourcemap: true,
  };
  writeFileSync(`${invocation.output}.original.ts`, source);
  writeFileSync(
    `${invocation.output}.before-transform.json`,
    JSON.stringify({
      url,
      sourceHash,
      token: invocation.token,
      owner: encodeOwnerWire(owner),
      pid: process.pid,
      timestamp: new Date().toISOString(),
      oxc: options,
      instrumenter: instrumenter.opts,
    }),
  );
  const transformed = await transformWithOxc(source, path, options);

  return instrumentTransformed(transformed, invocation, instrumenter);
}

/**
 * preserves raw and supplemented maps while instrumenting transformed code
 * @param transformed actual public Oxc output
 * @param invocation validated original source and artifact destination
 * @param instrumenter public factory instance
 * @returns instrumented native module output
 */
function instrumentTransformed(
  transformed: Awaited<ReturnType<typeof transformWithOxc>>,
  invocation: z.infer<typeof invocationSchema>,
  instrumenter: ReturnType<typeof createInstrumenter>,
): Awaited<ReturnType<LoadHook>> {
  const path = fileURLToPath(invocation.sourceUrl);
  const { output } = invocation;
  if (!transformed.map) {
    throw new Error(`Oxc source map absent: ${path}`);
  }
  writeFileSync(`${output}.oxc.js`, transformed.code);
  writeFileSync(`${output}.input-map.json`, JSON.stringify(transformed.map));
  const inputMap = {
    ...transformed.map,
    file: transformed.map.file ?? path,
  };
  writeFileSync(`${output}.supplemented-map.json`, JSON.stringify(inputMap));
  const code = instrumenter.instrumentSync(
    transformed.code,
    `${path}.child.js`,
    inputMap,
  );
  writeFileSync(`${output}.instrumented.js`, code);
  writeFileSync(
    `${output}.geometry.json`,
    JSON.stringify(instrumenter.lastFileCoverage()),
  );
  writeFileSync(
    `${output}.instrumented-map.json`,
    JSON.stringify(instrumenter.lastSourceMap()),
  );

  return { format: 'module', shortCircuit: true, source: code };
}

const sourceMapVersion = 3;
const countsSchema = z.record(z.string(), z.number().int().nonnegative());
export const countersSchema = z.object({
  s: countsSchema,
  f: countsSchema,
  b: z.record(z.string(), z.array(z.number().int().nonnegative())),
});
export const childSchema = countersSchema.loose().extend({
  path: z.string(),
  statementMap: z.record(z.string(), z.unknown()),
  fnMap: z.record(z.string(), z.unknown()),
  branchMap: z.record(z.string(), z.unknown()),
  inputSourceMap: z.looseObject({
    version: z.literal(sourceMapVersion),
    file: z.string(),
    sources: z.array(z.string()),
    sourcesContent: z.array(z.string()),
  }),
});
