import { randomUUID } from 'node:crypto';

import type { UnitOfWork } from '@antica/application/ports';
import type { EvidenceAnchor, Observation, RecordCheck } from '@antica/domain';

/** persisted collector evidence and its real inspection method */
export interface LinkedAnalysisEvidence {
  readonly recordId: string;
  readonly componentId: string;
  readonly assetId: string;
  readonly methodId: string;
  readonly methodVersionId: string;
  readonly entryId: string;
  readonly anchor: EvidenceAnchor;
  readonly observation: Observation;
  readonly check: RecordCheck;
}

const now = '2026-10-13T00:00:00.000Z';

/**
 * creates a complete relational fixture through owner-scoped repositories
 */
export async function createLinkedAnalysisEvidence(
  unit: UnitOfWork,
): Promise<LinkedAnalysisEvidence> {
  const recordId = randomUUID();
  const componentId = randomUUID();
  const assetId = randomUUID();
  const viewId = randomUUID();
  const methodId = randomUUID();
  const methodVersionId = randomUUID();
  const entryId = randomUUID();
  const anchor: EvidenceAnchor = {
    id: randomUUID(),
    recordId,
    componentIds: [componentId],
    originalAssetId: assetId,
    canonicalViewId: viewId,
    kind: 'image',
    scope: {
      kind: 'region',
      region: { kind: 'rect', x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
      cropDerivativeId: null,
    },
    createdAt: now,
  };
  const observation: Observation = {
    id: randomUUID(),
    recordId,
    componentIds: [componentId],
    channel: 'typed',
    text: 'Visible repair',
    evidenceAnchorIds: [anchor.id],
    checkIds: [],
    observedAt: now,
    voice: null,
    editDraftId: null,
    supersedesObservationId: null,
    author: 'collector',
    createdAt: now,
    supersededByObservationId: null,
  };
  const check: RecordCheck = {
    id: randomUUID(),
    recordId,
    componentIds: [componentId],
    methodId,
    methodVersionId,
    suggestedByRunId: null,
    revision: 1,
    progress: 'in_progress',
    result: { kind: 'undetermined', reason: 'Requires close inspection' },
    observationIds: [observation.id],
    evidenceAnchorIds: [anchor.id],
    pendingActionIds: [],
    createdAt: now,
    updatedAt: now,
  };
  await unit.records.create({
    id: recordId,
    code: await unit.records.allocateCode(),
    name: null,
    unitKind: 'set',
    components: [{ id: componentId, label: 'Lid' }],
    pieceCount: 2,
    categoryIds: [],
    materialIds: [],
    period: null,
    dimensions: {},
    location: { locationId: null, detail: '' },
    acquisition: { receiptAssetIds: [] },
    tags: [],
    description: '',
    collectorJudgment: null,
    recordRevision: 1,
    analysisInputVersion: 1,
    evidenceVersion: 1,
    createdAt: now,
    updatedAt: now,
    mediaIds: [],
    checkIds: [],
    latestRunId: null,
    analysisFreshness: 'unanalyzed',
  });
  await unit.knowledge.create({
    id: entryId,
    displayCode: await unit.knowledge.allocateCode(),
    revision: 1,
    status: 'draft',
    content: {
      titleZhHant: '修復',
      aliases: [],
      kinds: ['repair'],
      otherKindLabel: null,
      summary: {
        textZhHant: '查看修復',
        citationIds: [],
        support: 'needs_source',
      },
      history: [],
      features: [],
      applicability: [],
      exampleReferenceImageIds: [],
      relatedEntryIds: [],
      citations: [],
    },
    methodIds: [],
    savedBy: null,
    createdAt: now,
    updatedAt: now,
  });
  await unit.knowledge.createMethod(
    {
      id: methodId,
      owningEntryId: entryId,
      currentVersionId: methodVersionId,
    },
    {
      id: methodVersionId,
      methodId,
      revision: 1,
      createdAt: now,
      definition: {
        titleZhHant: '檢查',
        history: [],
        featureEntryIds: [],
        applicability: [],
        observationModes: ['in_person_visual'],
        steps: [
          {
            order: 1,
            actionZhHant: '查看',
            evidenceToCaptureZhHant: '照片',
          },
        ],
        interpretationLimits: [],
        exampleReferenceImageIds: [],
        citations: [],
      },
    },
  );
  await unit.media.createUpload(
    {
      requestKey: randomUUID(),
      target: { kind: 'record', recordId },
      kind: 'photo',
      purpose: 'object',
      componentIds: [componentId],
      fileName: 'repair.jpg',
      mimeType: 'image/jpeg',
      byteLength: 5,
      sha256: 'a'.repeat(64),
    },
    {
      assetId,
      mode: 'single',
      expiresAt: '2030-01-01T00:00:00.000Z',
      putUrl: 'https://example.test/upload',
      headers: {},
    },
  );
  await unit.media.complete(assetId, {
    assetId,
    state: 'uploaded',
    processingJobId: null,
  });
  await unit.media.markReadyOnce(assetId, 'uploaded');
  await unit.media.addCanonicalView({
    id: viewId,
    originalAssetId: assetId,
    derivativeId: null,
    width: 100,
    height: 100,
    originalCoordinateSpace: 'image_pixels',
    transformToOriginal: [1, 0, 0, 0, 1, 0, 0, 0, 1],
  });
  await unit.evidence.addAnchor(anchor);
  await unit.evidence.addObservation(observation);
  await unit.evidence.addCheck(check);

  return {
    recordId,
    componentId,
    assetId,
    methodId,
    methodVersionId,
    entryId,
    anchor,
    observation,
    check,
  };
}
