import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { cursorPageSchema } from './shared.js';

describe('cursor page validation', () => {
  it('should reject an item that fails the page item contract', () => {
    const page = cursorPageSchema(z.int().positive());

    expect(page.safeParse({ items: [1], nextCursor: null }).success).toBe(true);
    expect(page.safeParse({ items: [0], nextCursor: null }).success).toBe(
      false,
    );
  });
});
