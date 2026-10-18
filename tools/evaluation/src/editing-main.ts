import { createDevelopmentModels } from '@antica/platform/ai';

import { parseEvaluationArguments, runCommand, writeReport } from './cli.js';
import { readEditingDataset } from './editing-dataset.js';
import { evaluateEditing } from './editing.js';
import { readLiveRegistry } from './registry.js';

/** runs the record-editing command against the current process */
export async function runEditingCommand(): Promise<void> {
  await runCommand(async () => {
    const args = parseEvaluationArguments(
      process.argv.slice(2),
      'editing-results.json',
      'editing-v1',
    );
    if (args.help) {
      process.stdout.write(
        'Editing: --snapshot <dataset ID or JSON file> --models <idA> [idB] --output <file or -> [--registry <JSON file>] [--runs <1..10>]\nChecks that one recordEditing call replies to the collector and proposes per-field edits (assumption A8). Defaults use labeled deterministic development adapters, which cannot settle A8; live gateway models require AI_GATEWAY_API_KEY, with no fallback.\n',
      );

      return;
    }
    const models = args.registry
      ? await readLiveRegistry(args.registry)
      : createDevelopmentModels();
    const report = await evaluateEditing({
      dataset: await readEditingDataset(args.snapshot),
      modelIds: args.models,
      profileVersion: 'evaluation-v1',
      runs: args.runs,
      model: models.recordEditing,
      catalog: models.catalog,
    });
    await writeReport(args.output, report);
    if (
      report.evaluations.some(
        (evaluation) =>
          evaluation.error !== null ||
          evaluation.passedCases !== evaluation.totalCases,
      )
    ) {
      process.exitCode = 1;
    }
  });
}

if (import.meta.main) {
  await runEditingCommand();
}
