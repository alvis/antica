import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { jobEnvelopeSchema } from './job.js';

const id = '00000000-0000-4000-8000-000000000001';

describe('job envelope validation', () => {
  it('should validate a completed result using its supplied resource schema', () => {
    const envelope = jobEnvelopeSchema(
      z.strictObject({ count: z.int().positive() }),
    );
    const job = {
      id,
      kind: 'research',
      resourceId: id,
      state: { kind: 'succeeded', completedAt: '2026-10-13T00:00:00Z' },
      createdAt: '2026-10-13T00:00:00Z',
      updatedAt: '2026-10-13T00:00:00Z',
      result: { count: 1 },
    };

    expect(envelope.safeParse(job).success).toBe(true);
    expect(envelope.safeParse({ ...job, result: { count: 0 } }).success).toBe(
      false,
    );
  });
});
