import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const covered = {
  statementMap: { '0': { start: { line: 1 } } },
  fnMap: {},
  branchMap: {},
  s: { '0': 1 },
  f: {},
  b: {},
};

/**
 * Creates a disposable project consumed by the real coverage CLI.
 * @returns Isolated source, collector, and receipt paths.
 */
function createFixture() {
  const root = realpathSync(
    mkdtempSync(join(tmpdir(), 'antica-coverage-cli-')),
  );
  const sourceRoot = join(root, 'apps/mobile/src');
  const tooling = join(root, 'tooling');
  mkdirSync(sourceRoot, { recursive: true });
  mkdirSync(tooling);
  const script = join(tooling, 'check-mobile-coverage.ts');
  copyFileSync(new URL('./check-mobile-coverage.ts', import.meta.url), script);
  const native = join(sourceRoot, 'auth.tsx');
  const dom = join(sourceRoot, 'mobile.stories.helpers.ts');
  writeFileSync(native, 'export const native = 1;');
  writeFileSync(dom, 'export const dom = 1;');

  return { root, script, native, dom };
}

/**
 * Runs the actual gate process and rejects process-launch errors.
 * @param script Executable gate copy.
 * @param args CLI arguments.
 * @returns Captured process result.
 */
function run(script: string, ...args: string[]) {
  const result = spawnSync(process.execPath, [script, ...args], {
    encoding: 'utf8',
  });
  assert.equal(result.error, undefined);

  return result;
}

/**
 * Produces fresh fixture receipts through the gate's collector boundary.
 * @param fixture Isolated project paths.
 * @returns Both coverage paths and their identity bindings.
 */
function collect(fixture: ReturnType<typeof createFixture>) {
  const paths = [
    'native.json',
    'native-binding.json',
    'dom.json',
    'dom-binding.json',
  ].map((name) => join(fixture.root, name));
  const [native, nativeBinding, dom, domBinding] = paths;
  assert.ok(native && nativeBinding && dom && domBinding);
  for (const [receipt, binding, source] of [
    [native, nativeBinding, fixture.native],
    [dom, domBinding, fixture.dom],
  ]) {
    assert.ok(receipt && binding && source);
    const producer = `require('node:fs').writeFileSync(${JSON.stringify(receipt)}, ${JSON.stringify(JSON.stringify({ [source]: covered }))})`;
    assert.equal(
      run(
        fixture.script,
        'run',
        receipt,
        binding,
        process.execPath,
        '-e',
        producer,
      ).status,
      0,
    );
  }

  return { paths, native, nativeBinding };
}

void describe('Coverage CLI source binding', () => {
  void it('should pass fresh receipts and reject a new branch in an existing covered file', () => {
    const fixture = createFixture();
    try {
      const { paths } = collect(fixture);
      assert.equal(run(fixture.script, 'verify', ...paths).status, 0);
      writeFileSync(
        fixture.native,
        'export const native = (input) => input ? 1 : 2;',
      );

      const result = run(fixture.script, 'verify', ...paths);

      assert.equal(result.status, 1);
      assert.match(result.stderr, /stale or incomplete/);
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  void it('should reject a receipt modified after its source binding was written', () => {
    const fixture = createFixture();
    try {
      const { paths, native } = collect(fixture);
      writeFileSync(native, '{}');

      const result = run(fixture.script, 'verify', ...paths);

      assert.equal(result.status, 1);
      assert.match(result.stderr, /Invalid coverage receipt binding/);
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  void it('should remove retained receipts before a collector that emits no coverage', () => {
    const fixture = createFixture();
    try {
      const { native, nativeBinding } = collect(fixture);

      const result = run(
        fixture.script,
        'run',
        native,
        nativeBinding,
        process.execPath,
        '-e',
        '',
      );

      assert.equal(result.status, 1);
      assert.equal(existsSync(native), false);
      assert.equal(existsSync(nativeBinding), false);
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  void it('should reject source drift during a successful collector process', () => {
    const fixture = createFixture();
    try {
      const native = join(fixture.root, 'native.json');
      const binding = join(fixture.root, 'binding.json');
      const producer = `const fs = require('node:fs'); fs.writeFileSync(${JSON.stringify(fixture.native)}, 'changed'); fs.writeFileSync(${JSON.stringify(native)}, '{}');`;

      const result = run(
        fixture.script,
        'run',
        native,
        binding,
        process.execPath,
        '-e',
        producer,
      );

      assert.equal(result.status, 1);
      assert.match(result.stderr, /sources changed during coverage collection/);
      assert.equal(existsSync(binding), false);
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });
});

void describe('Coverage CLI entrypoint', () => {
  void it('should execute validation when invoked through a filesystem symlink', () => {
    const fixture = createFixture();
    try {
      const alias = join(fixture.root, 'coverage-alias.ts');
      symlinkSync(fixture.script, alias);

      const result = run(alias, 'unsupported');

      assert.equal(result.status, 1);
      assert.match(result.stderr, /Expected coverage command/);
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });
});
