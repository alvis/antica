import { describe, expect, it, vi } from 'vitest';

import { createIsolatedDatabase } from './isolated-database.js';

describe('fn:createIsolatedDatabase', () => {
  it('should reject when the test database URL is missing', async () => {
    const originalUrl = process.env.ANTICA_TEST_DATABASE_URL;
    vi.stubEnv('ANTICA_TEST_DATABASE_URL', undefined);

    try {
      await expect(createIsolatedDatabase()).rejects.toThrow();
    } finally {
      vi.stubEnv('ANTICA_TEST_DATABASE_URL', originalUrl);
    }
  });
});
