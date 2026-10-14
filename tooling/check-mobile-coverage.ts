import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** sources exercised through the browser-compatible story runtime */
export const domCoverageSources = [
  'mobile.stories.helpers.ts',
  'mobile.stories.fixtures.tsx',
  'features/analysis/AnalysisContainer.stories.tsx',
  'features/collection/RecordContainer.stories.tsx',
  'features/capture/CaptureContainer.stories.tsx',
  'components/QueryState.stories.tsx',
  'components/Screen.stories.tsx',
  'mobile.stories.spec.dom.helpers.tsx',
] as const;

/** runtime helpers required even though generic discovery excludes spec files */
const runtimeCoverageSources = [
  'components/components.stories.spec.native.helpers.tsx',
  'mobile.stories.spec.dom.helpers.tsx',
] as const;

/**
 * narrows decoded coverage JSON to an object whose fields can be inspected
 * @param value decoded JSON value
 * @returns whether the value is a non-array object
 */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * enumerates every mobile source file eligible for the combined coverage gate
 * @param directory absolute directory to traverse recursively
 * @returns absolute source paths, excluding only tests and type declarations
 */
function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);

    return entry.isDirectory()
      ? sourceFiles(path)
      : /\.(?:ts|tsx)$/.test(entry.name) &&
          !entry.name.includes('.spec.') &&
          !entry.name.endsWith('.d.ts')
        ? [path]
        : [];
  });
}

interface CoverageRun {
  receipt: Readonly<Record<string, unknown>>;
  sourceHashes: Readonly<Record<string, unknown>>;
}

/**
 * checks exhaustive, disjoint native and DOM coverage against a strict 100% gate
 * @param sourceRoot mobile source directory
 * @param native native receipt and source identity
 * @param dom DOM receipt and source identity
 * @returns all coverage failures; an empty list is the sole passing result
 */
export function checkMobileCoverage(
  sourceRoot: string,
  native: CoverageRun,
  dom: CoverageRun,
): string[] {
  const currentHashes = snapshotMobileSources(sourceRoot);
  if (
    !sameSources(currentHashes, native.sourceHashes) ||
    !sameSources(currentHashes, dom.sourceHashes)
  ) {
    return ['Coverage source binding is stale or incomplete.'];
  }
  const sources = Object.keys(currentHashes);
  if (sources.length === 0) {
    return ['No eligible mobile source files were found.'];
  }

  return sources.flatMap((source) => {
    const name = relative(sourceRoot, source).replaceAll('\\', '/');
    const isDom = domCoverageSources.some((candidate) => candidate === name);
    const receipt = isDom ? dom.receipt : native.receipt;
    const other = isDom ? native.receipt : dom.receipt;
    const entry = receipt[source];
    const failures: string[] = [];
    if (other[source]) {
      failures.push('duplicate or incorrect runner ownership');
    }
    if (!isObject(entry)) {
      return [
        ...failures.map((failure) => `${name}: ${failure}`),
        `${name}: missing ${isDom ? 'DOM' : 'native'} coverage`,
      ];
    }
    failures.push(
      ...checkScalarCounts(entry.statementMap, entry.s, 'statements/lines'),
      ...checkScalarCounts(entry.fnMap, entry.f, 'functions'),
      ...checkBranchCounts(entry.branchMap, entry.b),
    );

    return failures.map((failure) => `${name}: ${failure}`);
  });
}

/**
 * captures the exact eligible source bytes for a coverage execution
 * @param sourceRoot mobile runtime source directory
 * @returns absolute source paths mapped to SHA-256 digests
 */
export function snapshotMobileSources(
  sourceRoot: string,
): Record<string, string> {
  return Object.fromEntries(
    [
      ...new Set([
        ...sourceFiles(sourceRoot),
        ...runtimeCoverageSources.map((path) => resolve(sourceRoot, path)),
      ]),
    ]
      .sort()
      .map((path) => [path, digest(path)]),
  );
}

/**
 * hashes a source or receipt without normalizing its bytes
 * @param path artifact to bind
 * @returns SHA-256 artifact digest
 */
function digest(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/**
 * checks both source inventory and content identity
 * @param current current source hashes
 * @param expected hashes captured by a coverage run
 * @returns whether every source matches and neither inventory has extra paths
 */
function sameSources(
  current: Record<string, string>,
  expected: Readonly<Record<string, unknown>>,
): boolean {
  return (
    Object.keys(current).length === Object.keys(expected).length &&
    Object.entries(current).every(([path, hash]) => expected[path] === hash)
  );
}

/**
 * validates statement or function map membership and positive execution counts
 * @param map instrumented source locations
 * @param counts execution counters for those locations
 * @param metric diagnostic metric label
 * @returns violations for the selected metric
 */
function checkScalarCounts(
  map: unknown,
  counts: unknown,
  metric: string,
): string[] {
  if (
    !isObject(map) ||
    !isObject(counts) ||
    Object.keys(map).length !== Object.keys(counts).length
  ) {
    return [`malformed ${metric} counters`];
  }
  if (metric === 'statements/lines' && Object.keys(map).length === 0) {
    return ['empty executable-source coverage'];
  }

  return Object.keys(map).flatMap((key) =>
    isCovered(counts[key]) ? [] : [`uncovered ${metric} ${key}`],
  );
}

/**
 * validates branch arm cardinality and positive execution counts
 * @param map instrumented branch locations
 * @param counts counters for every branch arm
 * @returns violations for branch coverage
 */
function checkBranchCounts(map: unknown, counts: unknown): string[] {
  if (
    !isObject(map) ||
    !isObject(counts) ||
    Object.keys(map).length !== Object.keys(counts).length
  ) {
    return ['malformed branch counters'];
  }

  return Object.entries(map).flatMap(([key, branch]) => {
    const arms = counts[key];
    const valid =
      isObject(branch) &&
      Array.isArray(branch.locations) &&
      Array.isArray(arms) &&
      arms.length > 0 &&
      arms.length === branch.locations.length &&
      arms.every(isCovered);

    return valid ? [] : [`uncovered or malformed branches ${key}`];
  });
}

/**
 * determines whether an execution counter proves the location was reached
 * @param count decoded execution counter
 * @returns whether a finite positive execution count was recorded
 */
function isCovered(count: unknown): boolean {
  return typeof count === 'number' && Number.isFinite(count) && count > 0;
}

/**
 * reads an Istanbul JSON receipt and rejects an invalid top-level structure
 * @param path coverage JSON path
 * @returns the decoded coverage map
 */
function readReceipt(path: string): Record<string, unknown> {
  const value: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (!isObject(value)) {
    throw new Error(`Invalid coverage receipt: ${path}`);
  }

  return value;
}

/**
 * executes one coverage collector and binds its new receipt to unchanged sources
 * @param sourceRoot mobile source inventory root
 * @param paths output locations for the coverage receipt and its binding
 * @param paths.receiptPath JSON output owned by the selected collector
 * @param paths.bindingPath identity receipt written after collection succeeds
 * @param command executable and arguments for the coverage collector
 */
function collectCoverage(
  sourceRoot: string,
  paths: { receiptPath: string; bindingPath: string },
  command: string[],
): void {
  const { receiptPath, bindingPath } = paths;
  const [executable, ...args] = command;
  if (!executable) {
    throw new Error('A coverage collector command is required.');
  }
  rmSync(receiptPath, { force: true });
  rmSync(bindingPath, { force: true });
  const sourceHashes = snapshotMobileSources(sourceRoot);
  const result = spawnSync(executable, args, { stdio: 'inherit' });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      `Coverage collector failed: ${result.status ?? result.signal}`,
    );
  }
  if (!sameSources(snapshotMobileSources(sourceRoot), sourceHashes)) {
    throw new Error('Mobile sources changed during coverage collection.');
  }
  writeFileSync(
    bindingPath,
    JSON.stringify({ sourceHashes, receiptSha256: digest(receiptPath) }),
  );
}

/**
 * verifies a coverage receipt has not changed since its source binding was written
 * @param receiptPath instrumentation receipt to verify
 * @param bindingPath collector-produced identity binding
 * @returns source hashes captured around the successful collector run
 */
function readBinding(
  receiptPath: string,
  bindingPath: string,
): Record<string, unknown> {
  const binding = readReceipt(bindingPath);
  if (
    !isObject(binding.sourceHashes) ||
    binding.receiptSha256 !== digest(receiptPath)
  ) {
    throw new Error(`Invalid coverage receipt binding: ${receiptPath}`);
  }

  return binding.sourceHashes;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
) {
  const [, , mode, ...args] = process.argv;
  const sourceRoot = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../apps/mobile/src',
  );
  if (mode === 'run') {
    const [receiptPath, bindingPath, ...command] = args;
    if (!receiptPath || !bindingPath) {
      throw new Error(
        'Usage: check-mobile-coverage.ts run <receipt> <binding> <command> [...args]',
      );
    }
    collectCoverage(sourceRoot, { receiptPath, bindingPath }, command);
  } else if (mode === 'verify') {
    const [nativePath, nativeBinding, domPath, domBinding] = args;
    if (!nativePath || !nativeBinding || !domPath || !domBinding) {
      throw new Error(
        'Usage: check-mobile-coverage.ts verify <native.json> <native-binding.json> <dom.json> <dom-binding.json>',
      );
    }
    const failures = checkMobileCoverage(
      sourceRoot,
      {
        receipt: readReceipt(nativePath),
        sourceHashes: readBinding(nativePath, nativeBinding),
      },
      {
        receipt: readReceipt(domPath),
        sourceHashes: readBinding(domPath, domBinding),
      },
    );
    if (failures.length > 0) {
      throw new Error(
        `Mobile coverage must be 100% for every source:\n${failures.join('\n')}`,
      );
    }
    process.stdout.write(
      'Mobile coverage: unchanged sources pass 100% statements, branches, functions, and lines.\n',
    );
  } else {
    throw new Error('Expected coverage command: run or verify.');
  }
}
