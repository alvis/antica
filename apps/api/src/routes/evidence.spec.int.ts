import { randomUUID } from 'node:crypto';

import { inject, describe, expect, assert } from 'vitest';

import {
  createEvidenceService,
  createKnowledgeService,
  createRecordService,
} from '@antica/application/server';

import {
  knowledgeDetailSchema,
  observationSchema,
  recordCheckSchema,
  recordDetailSchema,
} from '@antica/contracts';

import { createHttpTest } from '../fixtures/http/test.js';
import { knowledgeInput } from '../fixtures/knowledge.js';

import type {
  CommandReceipt,
  EvidenceRepository,
  TransactionPort,
} from '@antica/application/ports';
import type {
  EvidenceCreateRequest,
  RecordDetail,
  Observation,
} from '@antica/contracts';

const resources = inject('httpResources');
const it = createHttpTest(resources['routes/evidence']!);

describe('fn:createEvidenceRoutes', () => {
  it('should persist a collector observation and revision-controlled method check through HTTP', async ({
    fixture,
  }) => {
    const record = recordDetailSchema.parse(
      await (
        await fixture.request(
          '/v1/records',
          'POST',
          { unitKind: 'single' },
          randomUUID(),
        )
      ).json(),
    );
    const input = {
      recordId: record.id,
      componentIds: [],
      channel: 'typed',
      text: '觸感粗糙',
      evidenceAnchorIds: [],
      checkIds: [],
      observedAt: new Date().toISOString(),
      voice: null,
      editDraftId: null,
      supersedesObservationId: null,
    };
    const key = randomUUID();
    const response = await fixture.request(
      '/v1/observations',
      'POST',
      input,
      key,
    );
    expect(response.status).toBe(201);
    const observation = observationSchema.parse(await response.json());
    expect(observation).toMatchObject({
      text: input.text,
      author: 'collector',
    });
    expect(
      await (
        await fixture.request('/v1/observations', 'POST', input, key)
      ).json(),
    ).toEqual(observation);
    for (const query of ['', '?limit=1']) {
      expect(
        await (
          await fixture.request(`/v1/records/${record.id}/observations${query}`)
        ).json(),
      ).toEqual({ items: [observation], nextCursor: null });
    }
    const knowledge = knowledgeDetailSchema.parse(
      await (
        await fixture.request('/v1/knowledge', 'POST', knowledgeInput())
      ).json(),
    );
    const method = knowledge.methodVersions[0]!;
    const checkResponse = await fixture.request(
      `/v1/records/${record.id}/checks`,
      'POST',
      {
        expectedRecordRevision: 2,
        methodId: method.methodId,
        methodVersionId: method.id,
      },
      randomUUID(),
    );
    expect(checkResponse.status).toBe(201);
    const check = recordCheckSchema.parse(await checkResponse.json());
    expect(
      await (await fixture.request(`/v1/checks/${check.id}`)).json(),
    ).toEqual(check);
    const changed = await fixture.request(`/v1/checks/${check.id}`, 'PATCH', {
      requestKey: randomUUID(),
      expectedRevision: 1,
      expectedRecordRevision: 3,
      progress: 'in_progress',
    });
    expect(changed.status).toBe(200);
    expect(await changed.json()).toMatchObject({
      revision: 2,
      progress: 'in_progress',
    });
  });

  it.for([
    ['POST', '/v1/evidence', {}, true],
    ['POST', '/v1/observations', {}, true],
    ['POST', '/v1/records/missing/checks', {}, true],
    ['PATCH', '/v1/checks/missing', {}, true],
    ['GET', '/v1/records/missing/observations?limit=0', undefined, false],
    ['GET', '/v1/records/missing/observations?limit=101', undefined, false],
    ['GET', '/v1/records/missing/observations?limit=1.5', undefined, false],
  ] as const)(
    'should reject invalid %s %s',
    async ([method, path, body, hasKey], { fixture }) => {
      const response = await fixture.request(
        path,
        method,
        body,
        hasKey ? randomUUID() : undefined,
      );
      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({
        code: 'VALIDATION_FAILED',
      });
    },
  );

  it('should require idempotency keys on valid observation and check commands', async ({
    fixture,
  }) => {
    const observation = {
      recordId: randomUUID(),
      componentIds: [],
      channel: 'typed',
      text: '觀察',
      evidenceAnchorIds: [],
      checkIds: [],
      observedAt: new Date().toISOString(),
      voice: null,
      editDraftId: null,
      supersedesObservationId: null,
    };
    const check = {
      expectedRecordRevision: 1,
      methodId: randomUUID(),
      methodVersionId: randomUUID(),
    };
    for (const [path, body] of [
      ['/v1/observations', observation],
      ['/v1/records/missing/checks', check],
    ] as const) {
      const response = await fixture.request(path, 'POST', body);
      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({
        code: 'VALIDATION_FAILED',
        field: 'Idempotency-Key',
      });
    }
  });

  it.for([
    {
      mode: 'prepare_frame',
      requestKey: randomUUID(),
      recordId: randomUUID(),
      originalAssetId: randomUUID(),
      requestedTimeMs: 100,
    },
    {
      mode: 'create',
      requestKey: randomUUID(),
      evidence: {
        kind: 'image',
        recordId: randomUUID(),
        componentIds: [],
        originalAssetId: randomUUID(),
        canonicalViewId: randomUUID(),
        scope: { kind: 'whole' },
      },
    },
  ])(
    'should refuse inaccessible evidence resources for $mode',
    async (body, { fixture }) => {
      const response = await fixture.request('/v1/evidence', 'POST', body);
      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({ code: 'NOT_FOUND' });
    },
  );
});

const now = '2026-10-13T12:00:00.000Z';

describe('evidence creation transaction', () => {
  it.for(['missing', 'foreign-owner', 'other-record'] as const)(
    'should reject a %s check without persisting evidence',
    async (kind, { fixture: http }) => {
      const transaction = http.runtime.transaction;
      const ownerId = randomUUID();
      const seeded = {
        data: await createEvidenceFixture(transaction, ownerId),
      };
      const other = {
        data: await createEvidenceFixture(
          transaction,
          kind === 'foreign-owner' ? randomUUID() : ownerId,
        ),
      };
      const fixture = seeded.data;
      const request = {
        ...createRequest(fixture),
        checkId: kind === 'missing' ? randomUUID() : other.data.check.id,
      };
      const before = await readState(transaction, ownerId, {
        fixture,
        requestKey: request.requestKey,
      });
      const service = createEvidenceService(
        transaction,
        { now: () => now },
        { create: randomUUID },
      );

      expect(await service.createAnchor(ownerId, request)).toMatchObject({
        success: false,
        error: { code: 'EVIDENCE_INVALID', retryable: false },
      });

      expect(
        await readState(transaction, ownerId, {
          fixture,
          requestKey: request.requestKey,
        }),
      ).toEqual(before);
    },
  );

  it.for(['check', 'record', 'receipt'] as const)(
    'should roll back every persisted effect after a %s failure',
    async (stage, { fixture: http }) => {
      const transaction = http.runtime.transaction;
      const ownerId = randomUUID();
      const fixture = await createEvidenceFixture(transaction, ownerId);
      const request = createRequest(fixture);
      const before = await readState(transaction, ownerId, {
        fixture,
        requestKey: request.requestKey,
      });
      const failure = new Error('Receipt persistence unavailable');
      const failing: TransactionPort = {
        run: async (owner, operation) =>
          transaction.run(owner, async (unit) => {
            const work = {
              ...unit,
              evidence: {
                ...unit.evidence,
                updateCheck: async (check: RecordCheck, revision: number) =>
                  unit.evidence.updateCheck(
                    check,
                    revision + (stage === 'check' ? 1 : 0),
                  ),
              },
              records: {
                ...unit.records,
                bumpVersions: async (id, revision, changes) =>
                  unit.records.bumpVersions(
                    id,
                    revision + (stage === 'record' ? 1 : 0),
                    changes,
                  ),
              },
              commands: {
                ...unit.commands,
                insert: async (receipt: CommandReceipt): Promise<void> => {
                  if (stage === 'receipt') {
                    throw failure;
                  }
                  await unit.commands.insert(receipt);
                },
              },
            } satisfies Parameters<typeof operation>[0];

            return operation(work);
          }),
      };
      const service = createEvidenceService(
        failing,
        { now: () => now },
        { create: randomUUID },
      );

      if (stage === 'receipt') {
        await expect(service.createAnchor(ownerId, request)).rejects.toBe(
          failure,
        );
      } else {
        expect(await service.createAnchor(ownerId, request)).toMatchObject({
          success: false,
          error: { code: 'REVISION_CONFLICT', retryable: true },
        });
      }

      expect(
        await readState(transaction, ownerId, {
          fixture,
          requestKey: request.requestKey,
        }),
      ).toEqual(before);
    },
  );

  it('should persist one association and version increment while preserving check state and replaying without writes', async ({
    fixture: http,
  }) => {
    const transaction = http.runtime.transaction;
    const ownerId = randomUUID();
    const fixture = await createEvidenceFixture(transaction, ownerId);
    const anchorId = randomUUID();
    const request = createRequest(fixture);
    const service = createEvidenceService(
      transaction,
      { now: () => now },
      { create: () => anchorId },
    );
    const before = await readState(transaction, ownerId, {
      fixture,
      requestKey: request.requestKey,
    });

    const first = await service.createAnchor(ownerId, request);
    const after = await readState(transaction, ownerId, {
      fixture,
      requestKey: request.requestKey,
    });
    const replay = await service.createAnchor(ownerId, request);

    expect(first).toMatchObject({
      success: true,
      data: { id: anchorId, recordId: fixture.recordId },
    });
    assert(first.success);
    expect(replay).toEqual(first);
    expect(after.check).toEqual({
      ...fixture.check,
      revision: fixture.check.revision + 1,
      updatedAt: now,
      evidenceAnchorIds: expect.arrayContaining([fixture.anchor.id, anchorId]),
    });
    expect(after.check!.evidenceAnchorIds).toHaveLength(2);
    expect(after.record).toEqual({
      ...before.record,
      recordRevision: before.record!.recordRevision + 1,
      analysisInputVersion: before.record!.analysisInputVersion + 1,
      evidenceVersion: before.record!.evidenceVersion + 1,
      updatedAt: expect.any(String),
    });
    expect(after.anchors.map((anchor) => anchor.id).sort()).toEqual(
      [fixture.anchor.id, anchorId].sort(),
    );
    expect(after.receipt).toMatchObject({
      ownerId,
      operation: 'evidence.create',
      requestKey: request.requestKey,
      status: 201,
      result: first.data,
    });
    expect(
      await readState(transaction, ownerId, {
        fixture,
        requestKey: request.requestKey,
      }),
    ).toEqual(after);
    expect(
      await service.createAnchor(ownerId, {
        ...request,
        checkId: randomUUID(),
      }),
    ).toMatchObject({
      success: false,
      error: { code: 'VALIDATION_FAILED' },
    });
    expect(
      await readState(transaction, ownerId, {
        fixture,
        requestKey: request.requestKey,
      }),
    ).toEqual(after);
  });
});

function createRequest(
  fixture: EvidenceFixture,
): Extract<EvidenceCreateRequest, { mode: 'create' }> {
  return {
    mode: 'create',
    requestKey: randomUUID(),
    checkId: fixture.check.id,
    evidence: {
      recordId: fixture.recordId,
      componentIds: [fixture.componentId],
      originalAssetId: fixture.assetId,
      canonicalViewId: fixture.anchor.canonicalViewId,
      kind: 'image',
      scope: { kind: 'whole' },
    },
  };
}

async function readState(
  transaction: TransactionPort,
  ownerId: string,
  { fixture, requestKey }: { fixture: EvidenceFixture; requestKey: string },
): Promise<{
  readonly record: RecordDetail | null;
  readonly check: RecordCheck | null;
  readonly anchors: readonly EvidenceAnchor[];
  readonly receipt: CommandReceipt | null;
}> {
  const result = await transaction.run(ownerId, async (unit) => ({
    success: true as const,
    data: {
      record: await unit.records.get(fixture.recordId),
      check: await unit.evidence.getCheck(fixture.check.id),
      anchors: await unit.evidence.queryAnchorsByAsset(fixture.assetId),
      receipt: await unit.commands.get(ownerId, 'evidence.create', requestKey),
    },
  }));

  return result.data;
}

type EvidenceAnchor = Parameters<EvidenceRepository['addAnchor']>[0];
type RecordCheck = Parameters<EvidenceRepository['updateCheck']>[0];

interface EvidenceFixture {
  readonly recordId: string;
  readonly componentId: string;
  readonly assetId: string;
  readonly anchor: EvidenceAnchor;
  readonly check: RecordCheck;
}

async function createEvidenceFixture(
  transaction: TransactionPort,
  ownerId: string,
): Promise<EvidenceFixture> {
  const clock = { now: () => now };
  const ids = { create: randomUUID };
  const componentId = randomUUID();
  const created = await createRecordService(transaction, clock, ids).create(
    ownerId,
    randomUUID(),
    {
      unitKind: 'set',
      pieceCount: 2,
      components: [{ id: componentId, label: 'Lid' }],
    },
  );
  assert(created.success);
  const knowledge = await createKnowledgeService(
    transaction,
    clock,
    ids,
  ).create(ownerId, knowledgeInput());
  assert(knowledge.success);
  const method = knowledge.data.methodVersions[0]!;
  const methodId = method.methodId;
  const methodVersionId = method.id;
  const recordId = created.data.id;
  const assetId = randomUUID();
  const viewId = randomUUID();
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

  await transaction.run(ownerId, async (unit) => {
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

    return { success: true, data: undefined };
  });

  return { recordId, componentId, assetId, anchor, check };
}
