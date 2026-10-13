import { describe, expect, it } from 'vitest';

import { transcriptionConfirmSchema } from './workflow.js';

const id = '00000000-0000-4000-8000-000000000001';

describe('transcription confirmation validation', () => {
  it('should require adopted collector text before confirmation', () => {
    const command = {
      requestKey: id,
      expectedRevision: 1,
      expectedRecordRevision: 1,
      adoptedTextZhHant: 'Collector observation',
      componentIds: [],
      evidenceAnchorIds: [],
      checkIds: [],
      observedAt: '2026-10-13T00:00:00Z',
    };

    expect(transcriptionConfirmSchema.safeParse(command).success).toBe(true);
    expect(
      transcriptionConfirmSchema.safeParse({
        ...command,
        adoptedTextZhHant: '  ',
      }).success,
    ).toBe(false);
  });
});
