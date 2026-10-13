import { parseEvaluationArguments, runCommand, writeReport } from './cli.js';
import { measureSensitivity } from './sensitivity.js';

await runCommand(async () => {
  const args = parseEvaluationArguments(
    process.argv.slice(2),
    'sensitivity-results.json',
  );
  if (args.help) {
    process.stdout.write(
      'Sensitivity: --output <file or ->\nReports seeded malformed-output/model/index detection and a known semantic false pass.\n',
    );

    return;
  }
  const report = await measureSensitivity();
  await writeReport(args.output, report);
  if (!report.passed) {
    process.exitCode = 1;
  }
});
