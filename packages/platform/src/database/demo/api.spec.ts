import { describe, expect, it } from 'vitest';

import { latestDevelopmentOtp, rebaseOrigin } from './api.js';

describe('fn:rebaseOrigin', () => {
  it('should keep the signed path and query on the host-reachable origin', () => {
    expect(
      rebaseOrigin(
        'http://10.0.2.2:8096/v1/storage/reads/token.sig?x=1',
        'http://127.0.0.1:8096',
      ),
    ).toBe('http://127.0.0.1:8096/v1/storage/reads/token.sig?x=1');
  });
});

describe('fn:latestDevelopmentOtp', () => {
  const inbox = [
    JSON.stringify({
      phoneNumber: '+15550100002',
      code: '111111',
      createdAt: '2026-10-20T08:00:00.000Z',
    }),
    JSON.stringify({
      phoneNumber: '+15550100001',
      code: '222222',
      createdAt: '2026-10-20T08:01:00.000Z',
    }),
    JSON.stringify({
      phoneNumber: '+15550100002',
      code: '333333',
      createdAt: '2026-10-20T08:02:00.000Z',
    }),
    '',
  ].join('\n');

  it('should return the newest code issued to the phone since the request', () => {
    expect(
      latestDevelopmentOtp(
        inbox,
        '+15550100002',
        new Date('2026-10-20T07:59:00.000Z'),
      ),
    ).toBe('333333');
  });

  it('should return null before the API issued a new code', () => {
    expect(
      latestDevelopmentOtp(
        inbox,
        '+15550100002',
        new Date('2026-10-20T08:03:00.000Z'),
      ),
    ).toBeNull();
  });
});
