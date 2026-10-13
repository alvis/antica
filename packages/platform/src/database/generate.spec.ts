import { EventEmitter } from 'node:events';
import { realpathSync } from 'node:fs';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const spawn = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({ spawn }));

describe('database migration generator command', () => {
  const originalExitCode = process.exitCode;

  beforeEach(() => {
    vi.resetModules();
    spawn.mockReset();
  });

  afterEach(() => {
    process.exitCode = originalExitCode;
  });

  it('runs Drizzle Kit from the platform package and forwards success', async () => {
    const child = new EventEmitter();
    spawn.mockReturnValue(child);

    await import('./generate.js');

    expect(spawn).toHaveBeenCalledWith(
      process.execPath,
      [
        expect.any(String),
        'generate',
        '--config',
        './src/database/drizzle.config.ts',
      ],
      { cwd: expect.any(URL), stdio: 'inherit', shell: false },
    );
    const executable = spawn.mock.calls[0]?.[1]?.[0] as string;
    expect(realpathSync(executable)).toBe(
      realpathSync(
        new URL('../../node_modules/drizzle-kit/bin.cjs', import.meta.url),
      ),
    );
    const options = spawn.mock.calls[0]?.[2] as { cwd: URL };
    expect(options.cwd.pathname).toMatch(/\/packages\/platform\/?$/);
    child.emit('exit', 0);
    expect(process.exitCode).toBe(0);
  });

  it('forwards a nonzero child exit code', async () => {
    const child = new EventEmitter();
    spawn.mockReturnValue(child);

    await import('./generate.js');
    child.emit('exit', 7);

    expect(process.exitCode).toBe(7);
  });

  it('reports a missing child exit code as failure', async () => {
    const child = new EventEmitter();
    spawn.mockReturnValue(child);

    await import('./generate.js');
    child.emit('exit', null);

    expect(process.exitCode).toBe(1);
  });
});
