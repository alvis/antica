import { describe, expect, it } from 'vitest';

import {
  editDraftApplySchema,
  transcriptionConfirmSchema,
} from './workflow.js';

const id = '00000000-0000-4000-8000-000000000001';
const otherId = '00000000-0000-4000-8000-000000000002';

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

describe('edit draft adoption validation', () => {
  const command = {
    requestKey: id,
    expectedDraftRevision: 2,
    expectedRecordRevision: 1,
    selectedProposalIds: [id],
  };

  it('should accept selected proposals with or without skipped ones', () => {
    expect(editDraftApplySchema.safeParse(command).success).toBe(true);
    expect(
      editDraftApplySchema.safeParse({
        ...command,
        skippedProposalIds: [otherId],
      }).success,
    ).toBe(true);
  });

  it('should accept a reject-only adoption', () => {
    expect(
      editDraftApplySchema.safeParse({
        ...command,
        selectedProposalIds: [],
        skippedProposalIds: [otherId],
      }).success,
    ).toBe(true);
  });

  it('should reject an adoption that decides no proposal', () => {
    const result = editDraftApplySchema.safeParse({
      ...command,
      selectedProposalIds: [],
      skippedProposalIds: [],
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['selectedProposalIds']);
    expect(
      editDraftApplySchema.safeParse({ ...command, selectedProposalIds: [] })
        .success,
    ).toBe(false);
  });

  it('should reject a proposal selected and skipped in the same adoption', () => {
    const result = editDraftApplySchema.safeParse({
      ...command,
      skippedProposalIds: [id],
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['skippedProposalIds']);
  });
});
