import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  parseCorpusArguments,
  readCorpusDirectory,
  runCorpusCommand,
} from './cli.js';
import { createCorpusFixture } from './fixtures/corpus.js';

const control = createCorpusFixture();

/**
 * Writes a disposable corpus and always removes its owned directory.
 * @param run callback that exercises the disposable corpus directory
 */
function withDirectory(run: (directory: string) => void): void {
  const directory = mkdtempSync(join(tmpdir(), 'antica-corpus-cli-'));
  try {
    for (const document of control) {
      const path = join(directory, document.path);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, document.text);
    }
    run(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

describe('cmd: corpus:validate', () => {
  it('should validate a complete offline directory with configurable diversity', () => {
    withDirectory((directory) => {
      const stdout: string[] = [];
      const stderr: string[] = [];
      expect(
        runCorpusCommand(
          ['--dir', directory, '--release', '1.0.0', '--min-providers', '2'],
          {
            stdout: (text) => stdout.push(text),
            stderr: (text) => stderr.push(text),
          },
        ),
      ).toBe(0);
      expect({ stdout: stdout.join(''), stderr }).toEqual({
        stdout: expect.stringContaining('0 errors; 4 topics; 40 entries;'),
        stderr: [],
      });
      expect(readCorpusDirectory(directory)).toEqual(
        [...control].sort((left, right) => left.path.localeCompare(right.path)),
      );
    });
  });

  it('should return failure with a file and JSON path for invalid corpus bytes', () => {
    withDirectory((directory) => {
      writeFileSync(join(directory, 'taxonomy.json'), '{');
      const diagnostics: string[] = [];
      const result = runCorpusCommand(['--dir', directory], {
        stdout: (text) => diagnostics.push(text),
        stderr: (text) => diagnostics.push(text),
      });
      expect({ result, diagnostics: diagnostics.join('') }).toEqual({
        result: 1,
        diagnostics: expect.stringContaining('taxonomy.json:$ [json]'),
      });
    });
  });

  it('should reject malformed UTF-8 before checking manifest hashes', () => {
    withDirectory((directory) => {
      writeFileSync(join(directory, 'README.md'), Buffer.from([0xff]));
      const stdout: string[] = [];
      const stderr: string[] = [];
      expect(
        runCorpusCommand(['--dir', directory], {
          stdout: (text) => stdout.push(text),
          stderr: (text) => stderr.push(text),
        }),
      ).toBe(1);
      expect(stdout).toEqual([]);
      expect(stderr).toEqual([
        `${join(directory, 'README.md')}:$ Invalid UTF-8 encoding\n`,
      ]);
    });
  });

  it('should preserve valid UTF-8 replacement characters and byte-order marks', () => {
    withDirectory((directory) => {
      const text = '\uFEFF\uFFFD繁體中文';
      writeFileSync(join(directory, 'README.md'), text);
      expect(
        readCorpusDirectory(directory).find(({ path }) => path === 'README.md'),
      ).toEqual({ path: 'README.md', text });
    });
  });

  it('should reject symlinked input without following it outside the corpus', () => {
    withDirectory((directory) => {
      const link = join(directory, 'outside');
      symlinkSync(tmpdir(), link);
      expect(() => readCorpusDirectory(directory)).toThrow(
        'Symbolic links are not allowed',
      );
    });
  });

  it('should show help without reading a corpus directory', () => {
    const text: string[] = [];
    expect(
      runCorpusCommand(['--help', '-h'], {
        stdout: (value) => text.push(value),
        stderr: (value) => text.push(value),
      }),
    ).toBe(0);
    expect(text.join('')).toContain('Usage: pnpm corpus:validate');
  });

  it('should report unavailable input with nonzero status through default stderr', () => {
    expect(
      runCorpusCommand(['--dir', '/nonexistent/antica-kdb07-corpus']),
    ).toBe(1);
  });

  it('should emit help through the default stdout writer', () => {
    expect(runCorpusCommand(['--help'])).toBe(0);
  });
});

describe('fn:parseCorpusArguments', () => {
  it('should supply repository defaults and normalize directory paths', () => {
    expect(parseCorpusArguments([])).toEqual({
      directory: expect.stringMatching(/corpus\/antica\/v1$/),
      minimumProviders: 2,
      help: false,
    });
    expect(
      parseCorpusArguments([
        '--dir',
        '.',
        '--release',
        '1.2.3',
        '--min-providers',
        '3',
      ]),
    ).toEqual({
      directory: resolve('.'),
      release: '1.2.3',
      minimumProviders: 3,
      help: false,
    });
  });

  it.each([
    ['--unknown'],
    ['--dir'],
    ['--dir', ''],
    ['--release', '--dir'],
    ['--release', '../1'],
    ['--min-providers', '0'],
    ['--min-providers', '1.5'],
    ['--min-providers', '999999999999999999'],
    ['--dir', '.', '--dir', '.'],
  ])('should reject invalid CLI arguments %j', (...args) => {
    expect(() => parseCorpusArguments(args)).toThrow();
  });
});
