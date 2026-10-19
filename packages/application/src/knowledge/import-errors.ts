import { KnowledgeProviderError } from '@antica/contracts';

import type { ImportBatch, ImportCheckpoint } from '@antica/contracts';

import type { KnowledgeImportParams } from './import.js';

const millisecondsPerSecond = 1_000;

/**
 * applies exponential backoff with jitter and a minimum upstream Retry-After
 * @param params clock and random source
 * @param error provider retry metadata
 * @param attempt bounded attempt number
 * @returns earliest permissible retry instant
 */
export function retryTime(
  params: KnowledgeImportParams,
  error: KnowledgeProviderError,
  attempt: number,
): string {
  const now = Date.parse(params.now());
  const seconds = Number(error.retryAfter);
  const requested =
    error.retryAfter === undefined
      ? now
      : Number.isFinite(seconds)
        ? now + Math.max(0, seconds) * millisecondsPerSecond
        : Date.parse(error.retryAfter);

  return new Date(
    Math.max(
      now +
        millisecondsPerSecond *
          2 ** (attempt - 1) *
          (1 + (params.random ?? Math.random)()),
      Number.isNaN(requested) ? now : requested,
    ),
  ).toISOString();
}

/**
 * sanitizes unknown provider failures
 * @param error remote or mapping exception
 * @returns bounded retry metadata
 */
export function providerError(error: unknown): KnowledgeProviderError {
  return error instanceof KnowledgeProviderError
    ? error
    : new KnowledgeProviderError({ code: 'PROVIDER_FAILURE', retryable: true });
}

/**
 * creates a paused batch retaining its last checkpoint
 * @param checkpoint last valid checkpoint
 * @param reason explicit pause reason
 * @returns paused batch
 */
export function stopped(
  checkpoint: ImportCheckpoint,
  reason: string,
): ImportBatch {
  return { checkpoint, objects: [], reason, retryAfter: null, stop: true };
}
