import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateCorpusDocuments } from './validate.js';

import type { CorpusDocument } from './validate.js';

/** Command-line release selection and offline input directory. */
export interface CorpusArguments {
  directory: string;
  release?: string;
  minimumProviders: number;
  help: boolean;
}
/** Writable output capabilities for the command. */
export interface CorpusOutput {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

const usage =
  'Usage: pnpm corpus:validate [--release <version>] [--dir <directory>] [--min-providers <integer>]\n';
const defaultDirectory = fileURLToPath(
  new URL('../../../corpus/antica/v1', import.meta.url),
);
const output: CorpusOutput = {
  stdout: (text) => {
    process.stdout.write(text);
  },
  stderr: (text) => {
    process.stderr.write(text);
  },
};

/**
 * Runs deterministic offline validation and reports file/JSON-path failures.
 * @param args command-line arguments
 * @param io command output writers
 * @returns zero on success, one on validation or input failure
 */
export function runCorpusCommand(
  args: readonly string[],
  io: CorpusOutput = output,
): number {
  try {
    const options = parseCorpusArguments(args);
    if (options.help) {
      io.stdout(usage);

      return 0;
    }
    const result = validateCorpusDocuments(
      readCorpusDirectory(options.directory),
      {
        release: options.release,
        minimumProviders: options.minimumProviders,
      },
    );
    for (const issue of result.issues) {
      io.stderr(
        `${issue.file}:${issue.path} [${issue.code}] ${issue.message}\n`,
      );
    }
    const counts = result.counts;
    io.stdout(
      `Corpus validation: ${result.issues.length} errors; ${counts.topics} topics; ${counts.entries} entries; ${counts.claims} claims; ${counts.sources} source snapshots; ${counts.images} distinct image URLs; ${counts.questions} questions.\n`,
    );

    return result.issues.length === 0 ? 0 : 1;
  } catch (error) {
    io.stderr(`${(error as Error).message}\n`);

    return 1;
  }
}

/**
 * Parses supported arguments without accepting implicit or ambiguous values.
 * @param args command-line arguments
 * @returns normalized command options
 */
export function parseCorpusArguments(args: readonly string[]): CorpusArguments {
  const options: CorpusArguments = {
    directory: defaultDirectory,
    minimumProviders: 2,
    help: false,
  };
  const seen = new Set<string>();
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === '--help' || flag === '-h') {
      options.help = true;
      continue;
    }
    if (
      flag !== '--release' &&
      flag !== '--dir' &&
      flag !== '--min-providers'
    ) {
      throw new Error(`Unknown argument: ${flag}\n${usage}`);
    }
    if (seen.has(flag)) {
      throw new Error(`Duplicate argument: ${flag}`);
    }
    seen.add(flag);
    const value = args[index + 1];
    if (value === undefined || value.startsWith('--') || value.length === 0) {
      throw new Error(`Missing value for ${flag}`);
    }
    index += 1;
    applyArgument(options, flag, value);
  }

  return options;
}

/**
 * Reads corpus members in stable order and rejects links or invalid UTF-8.
 * @param directory corpus root
 * @returns exact UTF-8 contents indexed by relative slash-separated paths
 */
export function readCorpusDirectory(directory: string): CorpusDocument[] {
  const visit = (path: string): CorpusDocument[] => {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) {
      throw new Error(`${path}:$ Symbolic links are not allowed`);
    }
    if (!stat.isDirectory()) {
      const bytes = readFileSync(path);
      const text = bytes.toString('utf8');
      if (!Buffer.from(text, 'utf8').equals(bytes)) {
        throw new Error(`${path}:$ Invalid UTF-8 encoding`);
      }

      return [
        {
          path: relative(directory, path).split('\\').join('/'),
          text,
        },
      ];
    }

    return readdirSync(path)
      .sort()
      .flatMap((name) => visit(join(path, name)));
  };

  return visit(resolve(directory));
}

/**
 * Validates and applies one supported argument value.
 * @param options normalized command configuration
 * @param flag known value-bearing command argument
 * @param value raw argument value
 */
function applyArgument(
  options: CorpusArguments,
  flag: string,
  value: string,
): void {
  if (flag === '--release') {
    if (!/^\d+\.\d+\.\d+$/.test(value)) {
      throw new Error('Release must be a semantic version');
    }
    options.release = value;
  } else if (flag === '--dir') {
    options.directory = resolve(value);
  } else {
    if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) {
      throw new Error('Minimum providers must be a positive safe integer');
    }
    options.minimumProviders = Number(value);
  }
}
