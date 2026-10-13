import { describe, expect, it } from 'vitest';

import { measureSensitivity } from './sensitivity.js';

describe('fn:measureSensitivity', () => {
  it('should catch seeded structural defects and explicitly expose semantic false passes', async () => {
    const report = await measureSensitivity();
    expect(report).toMatchObject({
      passed: true,
      invalidCaseCount: 11,
      falsePassCount: 0,
      falsePassRate: 0,
      falseRejectCount: 0,
      semanticProbe: { accepted: true },
    });
  });
});
