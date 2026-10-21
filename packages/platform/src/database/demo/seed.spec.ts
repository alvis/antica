import { describe, expect, it, vi } from 'vitest';

import { seedDemo } from './seed.js';

const params = {
  databaseUrl: 'postgresql://unused@127.0.0.1:1/unused',
  apiOrigin: 'http://127.0.0.1:1',
  inboxPath: '/nonexistent',
};

describe('fn:seedDemo', () => {
  it('should refuse the end-to-end owner', async () => {
    await expect(
      seedDemo({ ...params, phoneNumber: '+15550100001' }),
    ).rejects.toEqual(
      new Error('The demo seed never writes the end-to-end owner'),
    );
  });

  it('should refuse any owner other than the demo owner', async () => {
    await expect(
      seedDemo({ ...params, phoneNumber: '+15550100003' }),
    ).rejects.toEqual(
      new Error('The demo seed only writes the demo owner +15550100002'),
    );
  });

  it('should refuse to run in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');

    await expect(
      seedDemo({ ...params, phoneNumber: '+15550100002' }),
    ).rejects.toEqual(new Error('The demo seed is development-only'));
  });
});
