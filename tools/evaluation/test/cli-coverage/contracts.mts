import type {
  invocationSchema,
  readOwnerSnapshot,
} from '../cli-coverage-global-setup.mjs';
import type { SpawnSyncReturns } from 'node:child_process';

import type { z } from 'zod';

/** binds a native child outcome to its invocation and retained owner */
export interface RunEntryResult {
  /** preserves the actual process outcome and output streams */
  result: SpawnSyncReturns<string>;
  /** retains the validated source, token and owner transport */
  invocation: z.infer<typeof invocationSchema>;
  /** retains the parent's complete in-memory owner observation */
  owner: ReturnType<typeof readOwnerSnapshot>;
}

/** separates live parent counter identities from copied numeric observations */
export interface ParentSnapshot {
  /** retains the current worker's public coverage store by reference */
  store: object;
  /** pairs file and nested counter references with independently copied counts */
  entries: Array<{ path: string; refs: unknown[]; metrics: number[][] }>;
}
