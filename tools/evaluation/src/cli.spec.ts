import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import { parseEvaluationArguments, runCommand, writeReport } from './cli.js';

describe('fn:parseEvaluationArguments', () => {
  it('should accept the documented multiple-model syntax and explicit output', () => {
    expect(
      parseEvaluationArguments(
        [
          '--',
          '--models',
          'first',
          'second',
          '--snapshot',
          'snapshot.json',
          '--output',
          '-',
        ],
        'result.json',
      ),
    ).toEqual({
      snapshot: 'snapshot.json',
      models: ['first', 'second'],
      output: '-',
      corpus: undefined,
      registry: undefined,
      reviews: undefined,
      limit: 2,
      help: false,
    });
  });

  it('should reject duplicate IDs, stray arguments, and invalid cutoffs', () => {
    for (const args of [
      ['--models', 'first', 'first'],
      ['stray'],
      ['--limit', '0'],
      ['--limit', '1.5'],
      ['--limit', '101'],
      ['--models', ''],
      ['--registry', 'profiles.json'],
    ]) {
      expect(() => parseEvaluationArguments(args, 'result.json')).toThrow(
        RangeError,
      );
    }
  });
});

describe('fn:writeReport', () => {
  it('should persist complete JSON and fail when the destination is unavailable', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'antica-report-'));
    try {
      const path = join(directory, 'report.json');
      const report = {
        errors: ['MODEL_UNKNOWN'],
        output: null,
        input: { version: 1 },
      };
      await writeReport(path, report);
      expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(report);
      await expect(
        writeReport(join(directory, 'missing', 'report.json'), report),
      ).rejects.toThrow();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('should emit JSON to standard output when explicitly requested', async () => {
    const write = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true);
    await writeReport('-', { status: 'complete' });
    expect(
      write.mock.calls.map(([content]) => JSON.parse(String(content))),
    ).toEqual([{ status: 'complete' }]);
  });
});

describe('fn:runCommand', () => {
  it('should preserve a command failure as stderr and an unsuccessful exit', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'antica-cli-'));
    try {
      const result = spawnSync(
        process.execPath,
        [
          '--import',
          pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href,
          fileURLToPath(new URL('./main.ts', import.meta.url)),
          '--unknown-option',
        ],
        { cwd: directory, encoding: 'utf8' },
      );
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('Unknown option');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('should retain a successful command outcome', async () => {
    await expect(runCommand(async () => undefined)).resolves.toBeUndefined();
  });
});
