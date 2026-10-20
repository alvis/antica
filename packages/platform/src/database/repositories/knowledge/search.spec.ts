import { describe, expect, it, vi } from 'vitest';

import {
  cursorBinding,
  encodeSearchCursor,
  readSearchCursor,
} from './search-cursor.js';
import { knowledgeSearchMode } from './search.js';

describe('fn:knowledgeSearchMode', () => {
  it('should select only explicit supported capabilities and reject unknown modes', () => {
    vi.stubEnv('ANTICA_KNOWLEDGE_SEARCH_MODE', undefined);
    expect(knowledgeSearchMode()).toBe('postgres');
    expect(knowledgeSearchMode('degraded')).toBe('degraded');
    expect(() => knowledgeSearchMode('automatic')).toThrow(TypeError);
  });

  it('should respect a configured degraded deployment', () => {
    vi.stubEnv('ANTICA_KNOWLEDGE_SEARCH_MODE', 'degraded');
    expect(knowledgeSearchMode()).toBe('degraded');
  });
});

describe('search cursor round trip', () => {
  it('should preserve rank positions and reject another context or malformed data', () => {
    const binding = cursorBinding({ ownerId: 'owner', query: '青花' });
    const cursor = {
      binding,
      generation: '17',
      lane: 2,
      score: 0.125,
      support: 1,
      id: '00000000-0000-4000-8000-000000000001',
      sort: 0,
      key: 'entry',
    };
    expect(readSearchCursor(encodeSearchCursor(cursor), binding)).toEqual(
      cursor,
    );
    expect(readSearchCursor(undefined, binding)).toBeNull();
    expect(
      readSearchCursor(
        encodeSearchCursor(cursor),
        cursorBinding({ ownerId: 'other', query: '青花' }),
      ),
    ).toBe(false);
    expect(
      readSearchCursor(Buffer.from('{}').toString('base64url'), binding),
    ).toBe(false);
    expect(readSearchCursor('invalid', binding)).toBe(false);
    expect(
      readSearchCursor(
        encodeSearchCursor({ ...cursor, id: 'not-a-uuid' }),
        binding,
      ),
    ).toBe(false);
  });
});
