import { describe, expect, it } from 'vitest';

import {
  knowledgeEvidenceSnapshotV1Schema,
  recordFieldsSchema,
} from '@antica/contracts';

import { createDevelopmentModels } from './model.js';

import type { KnowledgeEvidenceSnapshotV1 } from '@antica/contracts';

const recordId = '00000000-0000-4000-8000-000000000001';
const request = {
  requestKey: '00000000-0000-4000-8000-000000000002',
  recordId,
  expectedRecordRevision: 3,
  transcriptionIds: [],
  observationIds: [],
  instructionZhHant: 'What do the saved sources say?',
};
const context = {
  fields: recordFieldsSchema.parse({
    name: null,
    unitKind: 'set',
    components: [],
    pieceCount: null,
    categoryIds: [],
    materialIds: [],
    period: null,
    dimensions: {},
    location: { locationId: null, detail: '' },
    acquisition: { receiptAssetIds: [] },
    tags: [],
    description: '',
    collectorJudgment: null,
  }),
  versions: { recordRevision: 3, analysisInputVersion: 2, evidenceVersion: 1 },
};
const claim = {
  claimId: '00000000-0000-4000-8000-000000000003',
  claimKey: 'material',
  statement: 'This museum vase is porcelain.',
  originalText: 'This museum vase is porcelain.',
  language: 'en' as const,
  scope: { object: ['This vase'] },
  qualifiers: { attribution: 'tentative' },
  uncertainty: 'Not applicable to every vase.',
  sourceVersionIds: ['00000000-0000-4000-8000-000000000004'],
  citations: [
    {
      citationId: '00000000-0000-4000-8000-000000000005',
      sourceId: '00000000-0000-4000-8000-000000000006',
      sourceVersionId: '00000000-0000-4000-8000-000000000004',
      locatorId: '00000000-0000-4000-8000-000000000007',
      relation: 'supports' as const,
      sourceTitle: 'Museum catalog',
      excerpt: 'Porcelain vase',
    },
  ],
};
const entry = {
  entryId: '00000000-0000-4000-8000-000000000008',
  revision: 7,
  contentHash: 'b'.repeat(64),
  title: 'Museum vase',
  claims: [claim],
};
const snapshot = knowledgeEvidenceSnapshotV1Schema.parse({
  schemaVersion: 1,
  snapshotId: '00000000-0000-4000-8000-000000000009',
  snapshotHash: 'a'.repeat(64),
  recordId,
  recordRevision: 3,
  corpusGeneration: 'frozen-generation',
  entries: [entry],
});
const expectedRef = {
  entryId: entry.entryId,
  revision: entry.revision,
  claimKey: claim.claimKey,
  citationIds: [claim.citations[0]!.citationId],
};

/**
 * Runs the actual development driver with a frozen source snapshot.
 * @param knowledgeContext frozen evidence supplied to the driver, if available
 * @returns the validated driver draft
 */
async function draft(knowledgeContext?: KnowledgeEvidenceSnapshotV1) {
  const result = await createDevelopmentModels().recordEditing.draft(
    request,
    [],
    {
      ...context,
      ...(knowledgeContext ? { knowledgeContext } : {}),
    },
    {
      role: 'recordEditing',
      modelId: 'development:evidence-v1',
      profileVersion: 'test-v1',
    },
  );
  expect(result.success).toBe(true);
  if (!result.success) {
    throw new Error(result.error.message);
  }

  return result.data.value;
}

describe('fn:createDevelopmentModels frozen evidence', () => {
  it('should emit exact frozen references and preserve their constraints', async () => {
    const value = await draft(snapshot);

    expect(
      value.answerSegments?.flatMap((segment) => segment.evidenceRefs),
    ).toEqual([expectedRef]);
    const text = value
      .answerSegments!.map((segment) => segment.text)
      .join('\n');
    for (const constraint of [
      claim.statement,
      'This vase',
      'tentative',
      claim.uncertainty,
    ]) {
      expect(text).toContain(constraint);
    }
    expect(value.proposedChanges).toEqual([]);
  });

  it('should deterministically cap references at the first two frozen claims across entries', async () => {
    const second = {
      ...entry,
      entryId: '00000000-0000-4000-8000-000000000010',
      revision: 2,
      claims: [
        { ...claim, claimKey: 'shape', uncertainty: undefined },
        { ...claim, claimKey: 'excluded-third' },
      ],
    };
    const evidence = knowledgeEvidenceSnapshotV1Schema.parse({
      ...snapshot,
      entries: [entry, second],
    });

    const first = await draft(evidence);
    const repeated = await draft(evidence);

    expect(
      first.answerSegments?.flatMap((segment) => segment.evidenceRefs),
    ).toEqual([
      expectedRef,
      {
        ...expectedRef,
        entryId: second.entryId,
        revision: second.revision,
        claimKey: 'shape',
      },
    ]);
    expect(repeated.answerSegments).toEqual(first.answerSegments);
  });

  it('should keep references valid when frozen prose exceeds the answer text budget', async () => {
    const evidence = knowledgeEvidenceSnapshotV1Schema.parse({
      ...snapshot,
      entries: [
        { ...entry, claims: [{ ...claim, statement: 'x'.repeat(4100) }] },
      ],
    });

    const value = await draft(evidence);

    expect(
      value.answerSegments!.map((segment) => segment.text).join('\n').length,
    ).toBeLessThanOrEqual(4000);
    expect(
      value.answerSegments?.flatMap((segment) => segment.evidenceRefs),
    ).toEqual([expectedRef]);
  });

  it('should preserve the ordinary reply with empty or absent evidence without inventing references', async () => {
    const empty = await draft({ ...snapshot, entries: [] });
    const absent = await draft();

    expect(empty.answerSegments).toEqual([
      { text: absent.replyZhHant, evidenceRefs: [] },
    ]);
    expect(absent.answerSegments).toBeUndefined();
  });
});
