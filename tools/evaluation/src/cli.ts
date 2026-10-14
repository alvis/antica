import { writeFile } from 'node:fs/promises';

import { parseArgs } from 'node:util';

/** provides parsed command values without accepting unknown flags */
export interface EvaluationArguments {
  readonly snapshot: string;
  readonly models: readonly string[];
  readonly output: string;
  readonly corpus: string | undefined;
  readonly registry: string | undefined;
  readonly reviews: string | undefined;
  readonly limit: number;
  readonly help: boolean;
}

const maximumCutoff = 100;

/**
 * parses the shared developer-facing evaluation command options
 * @param args explicit process arguments
 * @param defaultOutput default persisted report path
 * @returns validated command inputs
 * @throws {RangeError} when cutoff or model arguments are invalid
 */
export function parseEvaluationArguments(
  args: readonly string[],
  defaultOutput: string,
): EvaluationArguments {
  const { values, positionals } = parseArgs({
    args: [...args].filter((value, index) => index !== 0 || value !== '--'),
    allowPositionals: true,
    options: {
      snapshot: { type: 'string', default: 'synthetic-evidence-v1' },
      models: { type: 'string', multiple: true },
      output: { type: 'string', default: defaultOutput },
      corpus: { type: 'string' },
      registry: { type: 'string' },
      reviews: { type: 'string' },
      limit: { type: 'string', default: '2' },
      help: { type: 'boolean', default: false },
    },
  });
  const limit = Number(values.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > maximumCutoff) {
    throw new RangeError('Limit must be an integer from 1 through 100');
  }
  const models = values.models
    ? [...values.models, ...positionals]
    : ['development:evidence-v1', 'development:evidence-v2'];
  if (values.registry && !values.models) {
    throw new RangeError('Live registry comparisons require explicit --models');
  }
  if (
    (!values.models && positionals.length > 0) ||
    models.some((model) => model.trim() === '') ||
    new Set(models).size !== models.length
  ) {
    throw new RangeError('Supply unique model IDs after --models');
  }

  return {
    snapshot: values.snapshot,
    models,
    output: values.output,
    corpus: values.corpus,
    registry: values.registry,
    reviews: values.reviews,
    limit,
    help: values.help,
  };
}

/**
 * persists a complete JSON report to the explicitly selected output
 * @param path report file or dash for standard output
 * @param report complete evaluation result
 * @returns completion of the write
 */
export async function writeReport(
  path: string,
  report: unknown,
): Promise<void> {
  const content = `${JSON.stringify(report, null, 2)}\n`;
  if (path === '-') {
    process.stdout.write(content);
  } else {
    await writeFile(path, content, 'utf8');
  }
}

/**
 * reports command failures through stderr and a failing process exit code
 * @param execute command action
 * @returns command completion
 */
export async function runCommand(execute: () => Promise<void>): Promise<void> {
  try {
    await execute();
  } catch (exception) {
    const error = exception as Error;
    process.stderr.write(`${error.name}: ${error.message}\n`);
    process.exitCode = 1;
  }
}
