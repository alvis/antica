import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const child = spawn(
  process.execPath,
  [
    fileURLToPath(new URL('./bin.cjs', import.meta.resolve('drizzle-kit'))),
    'generate',
    '--config',
    './src/database/drizzle.config.ts',
  ],
  {
    cwd: new URL('../..', import.meta.url),
    stdio: 'inherit',
    shell: false,
  },
);
child.on('exit', (code): void => {
  process.exitCode = code ?? 1;
});
