import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { inProposalOrder } from './edit-draft-skips.js';

describe('fn:inProposalOrder', () => {
  it('should order IDs as the draft lists its proposals and keep none without a result', () => {
    const [first, second] = [randomUUID(), randomUUID()];

    expect(
      inProposalOrder({ proposedChanges: [{ id: first }, { id: second }] }, [
        second,
        first,
        randomUUID(),
      ]),
    ).toEqual([first, second]);
    expect(inProposalOrder(null, [first])).toEqual([]);
  });
});
