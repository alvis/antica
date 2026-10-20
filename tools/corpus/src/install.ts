import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { corpusFileSchema } from '@antica/contracts';

import { installCorpusRelease } from '../../../packages/application/src/knowledge/corpus-install.js';
import { createCorpusConnection } from '../../../packages/platform/src/database/repositories/corpus-connection.js';
import { createCorpusInstallRepository } from '../../../packages/platform/src/database/repositories/corpus-install.js';

import { readCorpusDirectory } from './cli.js';
import { selectCorpusReleaseDocuments } from './release-selection.js';
import { validateCorpusDocuments } from './validate.js';

import type { CorpusInstallRequest } from '../../../packages/application/src/knowledge/corpus-install.js';

import type { CorpusOutput } from './cli.js';

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
 * validates the selected release before creating any database connection
 * @param args explicit owner, version, request key and optional directory/dry-run flags
 * @returns typed validated corpus installation request
 */
export function loadCorpusInstallRequest(
  args: readonly string[],
): CorpusInstallRequest {
  const { values } = parseArgs({
    args: [...args],
    options: {
      'owner-id': { type: 'string' },
      'release': { type: 'string' },
      'request-key': { type: 'string' },
      'dir': { type: 'string' },
      'dry-run': { type: 'boolean' },
    },
    strict: true,
    allowPositionals: false,
  });
  if (!values['owner-id'] || !values.release || !values['request-key']) {
    throw new Error(
      'Usage: pnpm corpus:install --owner-id <id> --release <version> --request-key <uuid> [--dir <path>] [--dry-run]',
    );
  }
  const documents = readCorpusDirectory(values.dir ?? defaultDirectory);
  const validation = validateCorpusDocuments(documents, {
    release: values.release,
  });
  if (validation.issues.length) {
    const diagnostics = validation.issues
      .map(
        (issue) =>
          `${issue.file}:${issue.path} [${issue.code}] ${issue.message}`,
      )
      .join('\n');
    throw new Error(`Corpus validation failed: ${diagnostics}`);
  }
  const files = selectCorpusReleaseDocuments(documents, values.release)
    .filter((document) => document.path.endsWith('.json'))
    .map((document) => corpusFileSchema.parse(JSON.parse(document.text)));
  const release = files.find(
    (file): file is Extract<typeof file, { kind: 'release' }> =>
      file.kind === 'release' && file.version === values.release,
  )!;

  return {
    ownerId: values['owner-id'],
    requestKey: values['request-key'],
    release,
    sources: files.filter((file) => file.kind === 'source'),
    entries: files.filter((file) => file.kind === 'entry'),
    topics: files
      .filter((file) => file.kind === 'taxonomy')
      .flatMap((file) => file.topics),
    dryRun: values['dry-run'] ?? false,
  };
}

/**
 * runs the validated owner-draft installation and reports dispositions and emitted SQL
 * @param args installation command arguments
 * @param io output capabilities
 * @returns zero after successful installation or read-only planning
 */
export async function runCorpusInstallCommand(
  args: readonly string[],
  io: CorpusOutput = output,
): Promise<number> {
  try {
    const request = loadCorpusInstallRequest(args);
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error('DATABASE_URL is required for corpus installation');
    }
    const connection = createCorpusConnection(url);
    try {
      let batchStart = 0;
      let maximum = 0;
      const repository = createCorpusInstallRepository(connection.db, {
        onBatch: (_index, phase) => {
          if (phase === 'start') {
            batchStart = connection.statementCount();
          } else {
            maximum = Math.max(
              maximum,
              connection.statementCount() - batchStart,
            );
          }
        },
      });
      const result = await installCorpusRelease(request, repository);
      io.stdout(
        `${JSON.stringify({ ...result, dryRun: request.dryRun, sqlStatements: connection.statementCount(), maximumBatchStatements: maximum })}\n`,
      );

      return 0;
    } finally {
      await connection.close();
    }
  } catch (error) {
    io.stderr(`${(error as Error).message}\n`);

    return 1;
  }
}
