import { describe, expect, it } from 'vitest';

import { editDraftResultSchema } from '@antica/contracts';

import {
  editableFields,
  editingInstruction,
  editingPromptVersion,
  editingSchemaVersion,
} from './editing.js';

describe('recordEditing instructions', () => {
  it('should allow exactly the schema-allowlisted proposal fields', () => {
    expect(editableFields).toEqual([
      'name',
      'description',
      'materialIds',
      'period',
      'tags',
      'collectorJudgment',
    ]);
    expect(editingInstruction).toContain(editableFields.join(', '));
  });

  it('should request a grounded reply that never claims an applied change', () => {
    expect(editingPromptVersion).toBe('editing-v2');
    expect(editingSchemaVersion).toBe('editing-v2');
    expect(editingInstruction).toMatch(/replyZhHant/u);
    expect(editingInstruction).toMatch(/untrusted/u);
    expect(editingInstruction).toMatch(/Never state or imply that any change/u);
    expect(editingInstruction).toMatch(/A question alone proposes nothing/u);
    expect(editingInstruction).toMatch(/mention each proposed field/u);
    expect(editingInstruction).toMatch(/exact current before value/u);
  });

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
