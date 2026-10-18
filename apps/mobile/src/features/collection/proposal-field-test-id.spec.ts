import { describe, expect, it } from '@jest/globals';

import { proposalFieldTestId } from './proposal-field-test-id';

describe('fn:proposalFieldTestId', () => {
  it.each([
    { field: 'name', expected: 'name' },
    { field: 'materialIds', expected: 'material-ids' },
    { field: 'collectorJudgment', expected: 'collector-judgment' },
  ] as const)('should name $field as $expected', ({ field, expected }) => {
    expect(proposalFieldTestId(field)).toBe(expected);
  });
});
