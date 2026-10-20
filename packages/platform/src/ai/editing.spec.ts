import { describe, expect, it } from 'vitest';

import { editDraftResultSchema } from '@antica/contracts';

describe('recordEditing legacy results', () => {
  it('should keep editing-v1 results without a reply parseable', () => {
    const stored = {
      editDraftId: '00000000-0000-4000-8000-000000000001',
      recordId: '00000000-0000-4000-8000-000000000002',
      baseVersions: {
        recordRevision: 1,
        analysisInputVersion: 1,
        evidenceVersion: 1,
      },
      sourceTranscriptionIds: [],
      sourceObservationIds: [],
      suggestedDescriptionZhHant: '舊描述',
      proposedChanges: [],
    };

    expect(editDraftResultSchema.parse(stored).replyZhHant).toBe('');
  });
});
