import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';

import {
  checkMobileCoverage,
  snapshotMobileSources,
} from './check-mobile-coverage.ts';

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
    const dom = join(root, 'features/analysis/AnalysisContainer.stories.tsx');
    mkdirSync(dirname(dom), { recursive: true });
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
        { receipt: nativeReceipt, sourceHashes: hashes },
        { receipt: domReceipt, sourceHashes: hashes },
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
