import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import type { SpawnSyncReturns } from 'node:child_process';

import type { RunnerIO, RunStep } from './run-maestro.ts';

/**
 * spawns a step synchronously and surfaces spawn errors and non-zero exits
 * @param step command to execute
 * @param stdio inherit output for visibility or pipe it back to the caller
 * @returns the completed process result
 */
function spawnStep(
  step: RunStep,
  stdio: 'inherit' | 'pipe',
): SpawnSyncReturns<string> {
  const result = spawnSync(step.command, step.args, {
    stdio,
    encoding: 'utf8',
  });
  const command = `${step.command} ${step.args.join(' ')}`;
  if (result.error) {
    throw new Error(`${command} could not start.`, { cause: result.error });
  }
  if (result.status !== 0) {
    // piped stderr explains the failure; inherited output is already on screen
    const detail = stdio === 'pipe' ? `: ${result.stderr.trim()}` : '';
    throw new Error(
      `${command} exited with ${result.status ?? result.signal}${detail}`,
    );
  }

  return result;
}

/** process-backed side effects for command-line use */
export const processIO: RunnerIO = {
  run: (step) => void spawnStep(step, 'inherit'),
  capture: (step) => spawnStep(step, 'pipe').stdout,
  readText: (path) => readFileSync(path, 'utf8'),
  now: () => new Date(),
  pause: (milliseconds) =>
    void Atomics.wait(
      new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT)),
      0,
      0,
      milliseconds,
    ),
};
