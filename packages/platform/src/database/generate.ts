import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const child = spawn(
  process.execPath,
  [createRequire(import.meta.url).resolve('prisma/build/index.js'), 'generate'],
  { cwd: new URL('../..', import.meta.url), stdio: 'inherit', shell: false },
);
child.on('exit', (code): void => {
  process.exitCode = code ?? 1;
});
