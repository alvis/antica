import { describe, expect, it } from 'vitest';

import {
  isResolvedCheckResult,
  normalizeComponentScope,
} from './inspection.js';

describe('fn:normalizeComponentScope', () => {
  it('should identify repeated component selections as the same check scope without altering the caller selection', () => {
    const components = ['right', 'left', 'right'];

    const result = normalizeComponentScope(components);

    expect(result).toEqual(['left', 'right']);
    expect(components).toEqual(['right', 'left', 'right']);
  });
});

describe('fn:isResolvedCheckResult', () => {
  it('should distinguish an unperformed check from an explicitly undetermined result', () => {
    expect(isResolvedCheckResult({ kind: 'unrecorded' })).toBe(false);
    expect(
      isResolvedCheckResult({ kind: 'undetermined', reason: '無法觸及底部' }),
    ).toBe(true);
  });
});
