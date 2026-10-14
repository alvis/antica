import { parseEvaluationArguments, runCommand, writeReport } from './cli.js';
import { readCorpus } from './dataset.js';
import { evaluateImages } from './images.js';
import { evaluateRetrieval } from './retrieval.js';

/** runs the retrieval command against the current process */
export async function runRetrievalCommand(): Promise<void> {
  await runCommand(async () => {
    const args = parseEvaluationArguments(
      process.argv.slice(2),
      'retrieval-results.json',
    );
    if (args.help) {
      process.stdout.write(
        'Retrieval: --corpus <JSON file> --limit <1..100> --output <file or ->\nThe default corpus is authored synthetic data, scored independently of inference.\n',
      );

      return;
    }
    const report = {
      text: await evaluateRetrieval(await readCorpus(args.corpus), args.limit),
      image: await evaluateImages(),
    };
    await writeReport(args.output, report);
    if (
      report.text.evaluations.some((evaluation) => evaluation.error !== null) ||
      report.image.error !== null
    ) {
      process.exitCode = 1;
    }
  });
}

if (import.meta.main) {
  await runRetrievalCommand();
}
