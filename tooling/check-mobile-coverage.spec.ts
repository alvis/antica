import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';

import {
  checkMobileCoverage,
  snapshotMobileSources,
} from './check-mobile-coverage.ts';

const runtimeSources = [
  {
    name: 'components/components.stories.spec.native.helpers.tsx',
    runner: 'native',
  },
  { name: 'mobile.stories.spec.dom.helpers.tsx', runner: 'dom' },
  { name: 'components/QueryState.stories.tsx', runner: 'dom' },
  { name: 'components/Screen.stories.tsx', runner: 'dom' },
  {
    name: 'features/collection/containers/RecordHistoryContainer.stories.tsx',
    runner: 'dom',
  },
  {
    name: 'features/collection/messages/containers/RecordMessagesContainer.stories.tsx',
    runner: 'dom',
  },
];

const covered = {
  statementMap: { '0': { start: { line: 1 } } },
  fnMap: { '0': {} },
  branchMap: { '0': { locations: [{}, {}] } },
  s: { '0': 1 },
  f: { '0': 1 },
  b: { '0': [1, 1] },
};

void describe('fn:checkMobileCoverage', () => {
  void it('should accept complete disjoint receipts and reject seeded omissions and uncovered counters', () => {
    const root = mkdtempSync(join(tmpdir(), 'antica-coverage-gate-'));
    const native = join(root, 'auth.tsx');
    const dom = join(
      root,
      'features/analysis/containers/AnalysisContainer.stories.tsx',
    );
    mkdirSync(dirname(dom), { recursive: true });
    for (const { name } of runtimeSources) {
      const source = join(root, name);
      mkdirSync(dirname(source), { recursive: true });
      writeFileSync(source, 'export const render = () => 1;');
    }
    writeFileSync(native, 'export const native = () => 1;');
    writeFileSync(dom, 'export const story = () => 1;');
    writeFileSync(join(root, 'auth.spec.tsx'), 'test-only code');
    writeFileSync(join(root, 'types.d.ts'), 'declare const value: string;');

    const hashes = snapshotMobileSources(root);
    const check = (
      nativeReceipt: Record<string, unknown>,
      domReceipt: Record<string, unknown>,
    ): string[] =>
      checkMobileCoverage(
        root,
        {
          receipt: {
            ...Object.fromEntries(
              runtimeSources
                .filter(({ runner }) => runner === 'native')
                .map(({ name }) => [join(root, name), covered]),
            ),
            ...nativeReceipt,
          },
          sourceHashes: hashes,
        },
        {
          receipt: {
            ...Object.fromEntries(
              runtimeSources
                .filter(({ runner }) => runner === 'dom')
                .map(({ name }) => [join(root, name), covered]),
            ),
            ...domReceipt,
          },
          sourceHashes: hashes,
        },
      );

    try {
      assert.deepEqual(check({ [native]: covered }, { [dom]: covered }), []);
      assert.match(
        check({}, { [dom]: covered }).join('\n'),
        /missing native coverage/,
      );
      assert.match(
        check({ [native]: covered }, {}).join('\n'),
        /missing DOM coverage/,
      );
      assert.match(
        check({ [native]: covered, [dom]: covered }, { [dom]: covered }).join(
          '\n',
        ),
        /incorrect runner ownership/,
      );
      for (const defective of [
        { ...covered, s: { '0': 0 } },
        { ...covered, f: { '0': 0 } },
        { ...covered, b: { '0': [1, 0] } },
        { ...covered, s: {} },
        { ...covered, f: {} },
        { ...covered, b: {} },
        { ...covered, b: { '0': [1] } },
        { ...covered, s: { '0': Number.NaN } },
        { ...covered, s: { '0': -1 } },
        { ...covered, s: { '0': '1' } },
        { ...covered, statementMap: {}, s: {} },
        { ...covered, statementMap: null },
        { ...covered, branchMap: { '0': { locations: [] } }, b: { '0': [] } },
      ]) {
        assert.notDeepEqual(
          check({ [native]: defective }, { [dom]: covered }),
          [],
        );
        assert.notDeepEqual(
          check({ [native]: covered }, { [dom]: defective }),
          [],
        );
      }
      writeFileSync(native, 'export const native = (value) => value ? 1 : 2;');
      assert.match(
        check({ [native]: covered }, { [dom]: covered }).join('\n'),
        /stale or incomplete/,
      );
      writeFileSync(native, 'export const native = () => 1;');
      writeFileSync(join(root, 'new-feature.ts'), 'export const value = 1;');
      assert.match(
        check({ [native]: covered }, { [dom]: covered }).join('\n'),
        /stale or incomplete/,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

void describe('Required runtime coverage', () => {
  for (const { name, runner } of runtimeSources) {
    void it(`should reject missing, misplaced and duplicate coverage for ${name}`, () => {
      withRuntimeCoverage((root, native, dom) => {
        const source = join(root, name);
        const hashes = snapshotMobileSources(root);
        const owner = runner === 'native' ? native : dom;
        const other = runner === 'native' ? dom : native;
        const withoutSource = Object.fromEntries(
          Object.entries(owner).filter(([path]) => path !== source),
        );
        const check = (
          owned: Record<string, unknown>,
          foreign: Record<string, unknown>,
        ): string[] =>
          checkMobileCoverage(
            root,
            {
              receipt: runner === 'native' ? owned : foreign,
              sourceHashes: hashes,
            },
            {
              receipt: runner === 'dom' ? owned : foreign,
              sourceHashes: hashes,
            },
          );

        assert.deepEqual(check(owner, other), []);
        assert.notDeepEqual(check(withoutSource, other), []);
        assert.notDeepEqual(
          check(withoutSource, { ...other, [source]: covered }),
          [],
        );
        assert.notDeepEqual(check(owner, { ...other, [source]: covered }), []);
      });
    });
  }

  for (const name of [
    'components/components.stories.spec.native.helpers.tsx',
    'mobile.stories.spec.dom.helpers.tsx',
  ]) {
    void it(`should reject uncovered and malformed counters for ${name}`, () => {
      withRuntimeCoverage((root, native, dom) => {
        const source = join(root, name);
        const hashes = snapshotMobileSources(root);
        for (const defective of [
          { ...covered, s: { '0': 0 } },
          { ...covered, f: { '0': 0 } },
          { ...covered, b: { '0': [1, 0] } },
          { ...covered, b: { '0': [1] } },
          { ...covered, b: {} },
          { ...covered, branchMap: { '0': { locations: [] } }, b: { '0': [] } },
          { ...covered, statementMap: {}, s: {} },
        ]) {
          const replace = (
            receipt: Record<string, unknown>,
          ): Record<string, unknown> =>
            Object.fromEntries(
              Object.entries(receipt).map(([path, entry]) => [
                path,
                path === source ? defective : entry,
              ]),
            );
          assert.notDeepEqual(
            checkMobileCoverage(
              root,
              { receipt: replace(native), sourceHashes: hashes },
              { receipt: replace(dom), sourceHashes: hashes },
            ),
            [],
          );
        }
      });
    });

    void it(`should invalidate both runner bindings after changing ${name}`, () => {
      withRuntimeCoverage((root, native, dom) => {
        const hashes = snapshotMobileSources(root);
        writeFileSync(
          join(root, name),
          'export const render = (ready: boolean) => ready ? 1 : 2;',
        );
        const current = snapshotMobileSources(root);

        assert.notDeepEqual(
          checkMobileCoverage(
            root,
            { receipt: native, sourceHashes: hashes },
            { receipt: dom, sourceHashes: current },
          ),
          [],
        );
        assert.notDeepEqual(
          checkMobileCoverage(
            root,
            { receipt: native, sourceHashes: current },
            { receipt: dom, sourceHashes: hashes },
          ),
          [],
        );
      });
    });

    void it(`should reject deletion and renaming of required ${name}`, () => {
      withRuntimeCoverage((root, native, dom) => {
        const source = join(root, name);
        const hashes = snapshotMobileSources(root);
        const verify = (): string[] =>
          checkMobileCoverage(
            root,
            { receipt: native, sourceHashes: hashes },
            { receipt: dom, sourceHashes: hashes },
          );
        renameSync(source, `${source}.renamed.tsx`);
        assert.throws(verify, { code: 'ENOENT' });
        renameSync(`${source}.renamed.tsx`, source);
        assert.deepEqual(verify(), []);
        rmSync(source);
        assert.throws(verify, { code: 'ENOENT' });
      });
    });
  }
});

/**
 * supplies disposable executable sources and disjoint coverage to a gate consumer
 * @param exercise assertions that may mutate the isolated files or receipts
 */
function withRuntimeCoverage(
  exercise: (
    root: string,
    native: Record<string, unknown>,
    dom: Record<string, unknown>,
  ) => void,
): void {
  const root = mkdtempSync(join(tmpdir(), 'antica-runtime-coverage-'));
  try {
    for (const { name } of runtimeSources) {
      const source = join(root, name);
      mkdirSync(dirname(source), { recursive: true });
      writeFileSync(source, 'export const render = () => 1;');
    }
    exercise(
      root,
      Object.fromEntries(
        runtimeSources
          .filter(({ runner }) => runner === 'native')
          .map(({ name }) => [join(root, name), covered]),
      ),
      Object.fromEntries(
        runtimeSources
          .filter(({ runner }) => runner === 'dom')
          .map(({ name }) => [join(root, name), covered]),
      ),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
