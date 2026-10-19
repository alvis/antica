import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execute = promisify(execFile);

/** database connection used for committed PostgreSQL migrations */
export interface MigrateParams {
  readonly url: string;
}

/**
 * applies committed Prisma migrations to a PostgreSQL database
 * @param params target PostgreSQL database
 * @param params.url
 * @returns completion once Prisma migrate deploy succeeds
 */
export async function migrateDatabase({ url }: MigrateParams): Promise<void> {
  await execute(
    process.execPath,
    [
      createRequire(import.meta.url).resolve('prisma/build/index.js'),
      'migrate',
      'deploy',
    ],
    {
      cwd: fileURLToPath(new URL('../..', import.meta.url)),
      env: { ...process.env, DATABASE_URL: url },
    },
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is required');
  }
  await migrateDatabase({ url });
}
