import { describe, expect, it } from 'vitest';

import { runKnowledgeSearchBackfill } from './search-backfill.js';

describe('fn:runKnowledgeSearchBackfill', () => {
  it('should refuse missing owner, empty owner and missing database before connecting', async () => {
    await expect(
      runKnowledgeSearchBackfill([], 'postgresql://unused'),
    ).rejects.toThrow(TypeError);
    await expect(
      runKnowledgeSearchBackfill(['--owner-id', ' '], 'postgresql://unused'),
    ).rejects.toThrow(TypeError);
    await expect(
      runKnowledgeSearchBackfill(['--owner-id', 'owner'], ''),
    ).rejects.toThrow(TypeError);
    await expect(
      runKnowledgeSearchBackfill(['--unexpected'], 'postgresql://unused'),
    ).rejects.toThrow(TypeError);
  });
});
