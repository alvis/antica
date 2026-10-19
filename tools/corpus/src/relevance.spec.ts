import { describe, expect, it, vi } from 'vitest';

import { runRelevanceCommand } from './relevance.js';

import type { CorpusOutput } from './cli.js';

const mocks = vi.hoisted(() => ({
  close: vi.fn(),
  install: vi.fn(),
  get: vi.fn(),
  save: vi.fn(),
  search: vi.fn(),
  items: vi.fn(),
  projections: vi.fn(),
  parse: vi.fn(),
}));
vi.mock('@antica/contracts', () => ({
  corpusFileSchema: { parse: mocks.parse },
}));
vi.mock(
  '../../../packages/application/src/knowledge/corpus-install.js',
  () => ({ installCorpusRelease: mocks.install }),
);
vi.mock('../../../packages/application/src/knowledge/service.js', () => ({
  createKnowledgeService: () => ({ getV2: mocks.get, updateV2: mocks.save }),
}));
vi.mock(
  '../../../packages/platform/src/database/repositories/corpus-connection.js',
  () => ({
    createCorpusConnection: () => ({
      db: {
        corpusInstallItem: { findMany: mocks.items },
        knowledgeSearchDocument: { findMany: mocks.projections },
      },
      close: mocks.close,
      statementCount: () => 42,
    }),
  }),
);
vi.mock(
  '../../../packages/platform/src/database/repositories/corpus-install.js',
  () => ({ createCorpusInstallRepository: vi.fn() }),
);
vi.mock(
  '../../../packages/platform/src/database/repositories/knowledge/search.js',
  () => ({ createKnowledgeSearchRepository: () => ({ search: mocks.search }) }),
);
vi.mock('../../../packages/platform/src/database/transaction.js', () => ({
  createTransactionPort: vi.fn(),
}));
vi.mock('./install.js', () => ({ loadCorpusInstallRequest: () => ({}) }));
vi.mock('./cli.js', () => ({
  readCorpusDirectory: () => [{ path: 'entry.json', text: '{}' }],
}));

/** @returns successful orchestration fixture with one saved entry and twenty questions */
function prepareRun(): CorpusOutput {
  vi.stubEnv('ANTICA_TEST_DATABASE_URL', 'postgres://localhost/relevance_test');
  mocks.parse.mockReturnValue({
    kind: 'owner_queries',
    provisional: true,
    questions: Array.from({ length: 20 }, (_, index) => ({
      id: String(index),
      category: index < 10 ? 'ceramics' : 'jades',
      language: index < 10 ? 'en' : 'zh-Hant',
      text: 'unchanged question',
      relevance: [{ entryId: 'content', grade: 3 }],
    })),
  });
  mocks.items.mockResolvedValue([{ entryId: 'entry', contentId: 'content' }]);
  mocks.get.mockResolvedValue({
    success: true,
    data: { detail: { revision: 1, content: { claims: [] } } },
  });
  mocks.save.mockResolvedValue({
    success: true,
    data: { revision: 2, content: { claims: [] } },
  });
  mocks.search.mockResolvedValue({
    success: true,
    data: { hits: [{ contentId: 'content' }] },
  });
  mocks.projections.mockResolvedValue([{ tokenizerVersion: 'fixture' }]);

  return { stdout: vi.fn(), stderr: vi.fn() };
}

describe('fn:runRelevanceCommand', () => {
  it('should save through the service and report measured categories and hashes', async () => {
    const io = prepareRun();
    expect(await runRelevanceCommand(io)).toBe(0);
    expect(mocks.save).toHaveBeenCalledWith(
      expect.any(String),
      'entry',
      expect.objectContaining({
        status: 'saved',
        expectedRevision: 1,
        reviewDecisions: [],
      }),
    );
    expect(mocks.search).toHaveBeenCalledTimes(20);
    expect(io.stdout).toHaveBeenCalledWith(
      expect.stringContaining('"recallAt5":1'),
    );
    expect(io.stdout).toHaveBeenCalledWith(
      expect.stringContaining('"savedReviewedSubset":'),
    );
    expect(mocks.close).toHaveBeenCalledOnce();
  });
  it('should preserve relevance misses and explicit degraded mode', async () => {
    const io = prepareRun();
    vi.stubEnv('ANTICA_KNOWLEDGE_SEARCH_MODE', 'degraded');
    mocks.search.mockResolvedValue({
      success: true,
      data: { hits: [{ id: 'unjudged', contentId: null }] },
    });
    expect(await runRelevanceCommand(io)).toBe(0);
    expect(io.stdout).toHaveBeenCalledWith(
      expect.stringContaining('"missingAt5":["content"]'),
    );
    expect(io.stdout).toHaveBeenCalledWith(
      expect.stringContaining('"mode":"degraded"'),
    );
  });
  it.each([undefined, 'postgres://localhost/production'])(
    'should reject unsafe database selection %s',
    async (url) => {
      vi.stubEnv('ANTICA_TEST_DATABASE_URL', url);
      const io = { stdout: vi.fn(), stderr: vi.fn() };
      expect(await runRelevanceCommand(io)).toBe(1);
      expect(mocks.install).not.toHaveBeenCalled();
    },
  );
  it.each([{ kind: 'entry' }, { kind: 'owner_queries', questions: [] }])(
    'should reject changed query shape',
    async (queries) => {
      const io = prepareRun();
      mocks.parse.mockReturnValue(queries);
      expect(await runRelevanceCommand(io)).toBe(1);
      expect(mocks.install).not.toHaveBeenCalled();
    },
  );
  it.each(['get', 'save', 'search'] as const)(
    'should close the database after %s failure',
    async (operation) => {
      const io = prepareRun();
      mocks[operation].mockResolvedValue({
        success: false,
        error: { message: 'operation failed' },
      });
      expect(await runRelevanceCommand(io)).toBe(1);
      expect(io.stderr).toHaveBeenCalledWith('operation failed\n');
      expect(mocks.close).toHaveBeenCalledOnce();
    },
  );
  it('should reject unavailable working detail', async () => {
    const io = prepareRun();
    mocks.get.mockResolvedValue({
      success: true,
      data: { detail: { entry: {} } },
    });
    expect(await runRelevanceCommand(io)).toBe(1);
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.close).toHaveBeenCalledOnce();
  });
  it('should write through default process output', async () => {
    prepareRun();
    const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    expect(await runRelevanceCommand()).toBe(0);
    vi.stubEnv('ANTICA_TEST_DATABASE_URL', undefined);
    expect(await runRelevanceCommand()).toBe(1);
    expect(stdout).toHaveBeenCalled();
    expect(stderr).toHaveBeenCalled();
  });
});
