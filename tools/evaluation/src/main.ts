import { createDevelopmentModels } from '@antica/platform/ai';

import { parseEvaluationArguments, runCommand, writeReport } from './cli.js';
import { compareInference } from './comparison.js';
import { readSnapshot } from './dataset.js';
import { readLiveRegistry } from './registry.js';
import { readReviews } from './review.js';

await runCommand(async () => {
  const args = parseEvaluationArguments(
    process.argv.slice(2),
    'inference-results.json',
  );
  if (args.help) {
    process.stdout.write(
      'Inference: --snapshot <fixture ID or JSON file> --models <idA> <idB> --output <file or -> [--registry <JSON file>] [--reviews <JSON file>]\nDefaults use labeled deterministic development adapters; live gateway models require AI_GATEWAY_API_KEY, with no fallback.\n',
    );

    return;
  }
  const models = args.registry
    ? await readLiveRegistry(args.registry)
    : createDevelopmentModels();
  const report = await compareInference({
    snapshot: await readSnapshot(args.snapshot),
    modelIds: args.models,
    profileVersion: 'evaluation-v1',
    model: models.analysis,
    catalog: models.catalog,
    reviews: args.reviews ? await readReviews(args.reviews) : undefined,
  });
  await writeReport(args.output, report);
  if (
    report.evaluations.some(
      (evaluation) =>
        evaluation.error !== null ||
        evaluation.checks?.schemaValid !== true ||
        evaluation.checks.citationsValid !== true,
    )
  ) {
    process.exitCode = 1;
  }
});
