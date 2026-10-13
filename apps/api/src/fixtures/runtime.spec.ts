import { describe, expect, it, vi } from 'vitest';

import { readKnowledgeConfiguration } from '@antica/platform';
import { createConfiguredModels } from '@antica/platform/ai';

import { createLocalSettings } from './runtime.js';

vi.mock('@antica/platform', async (importOriginal) => {
  const original = await importOriginal<typeof import('@antica/platform')>();

  return {
    ...original,
    readKnowledgeConfiguration: vi.fn(original.readKnowledgeConfiguration),
  };
});
vi.mock('@antica/platform/ai', async (importOriginal) => {
  const original = await importOriginal<typeof import('@antica/platform/ai')>();

  return {
    ...original,
    createConfiguredModels: vi.fn(original.createConfiguredModels),
  };
});

describe('fn:createLocalSettings', () => {
  it.each(['models', 'knowledge'] as const)(
    'should stop fixture setup when the %s configuration boundary returns a failure',
    (boundary) => {
      const unavailable = {
        success: false,
        error: {
          code: 'PROVIDER_UNAVAILABLE',
          message: 'Provider registry unavailable',
          retryable: false,
        },
      } as const;
      if (boundary === 'models') {
        vi.mocked(createConfiguredModels).mockReturnValueOnce(unavailable);
      } else {
        vi.mocked(readKnowledgeConfiguration).mockReturnValueOnce(unavailable);
      }
      expect(() => createLocalSettings()).toThrow();
    },
  );
});
