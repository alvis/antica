import { randomUUID } from 'node:crypto';

import { inject, describe, expect } from 'vitest';

import {
  createAnalysisService,
  createEditDraftService,
  createRecordService,
} from '@antica/application/server';
import {
  analysisAcceptedSchema,
  analysisRunDetailSchema,
  editDraftAcceptedSchema,
  editDraftDetailSchema,
  recordDetailSchema,
  recordHistoryPageSchema,
} from '@antica/contracts';

import { createHttpTest } from '../fixtures/http/test.js';

import type { ModelCatalogPort } from '@antica/application/ports';
import type {
  AnalysisRunDetail,
  EditDraftDetail,
  RecordDetail,
} from '@antica/contracts';

import type { HttpFixture } from '../fixtures/http.js';

const resources = inject('httpResources');
const it = createHttpTest(resources['routes/record-history']!);
const clock = { now: () => new Date().toISOString() };
const ids = { create: randomUUID };
const unusedCatalog: ModelCatalogPort = {
  resolve: async () => {
    throw new Error('Adoption never resolves a model');
  },
};

/**
 * creates a record with one collector observation (record revision 2)
 * @param fixture authenticated HTTP fixture
 * @returns created record
 */
async function createObservedRecord(
  fixture: HttpFixture,
): Promise<RecordDetail> {
  const record = recordDetailSchema.parse(
    await (
      await fixture.request(
        '/v1/records',
        'POST',
        {
          unitKind: 'single',
          name: 'Collector name',
          description: 'Collector description',
        },
        randomUUID(),
      )
    ).json(),
  );
  const observed = await fixture.request(
    '/v1/observations',
    'POST',
    {
      recordId: record.id,
      componentIds: [],
      channel: 'typed',
      text: '釉面粗糙',
      evidenceAnchorIds: [],
      checkIds: [],
      observedAt: new Date().toISOString(),
      voice: null,
      editDraftId: null,
      supersedesObservationId: null,
    },
    randomUUID(),
  );
  expect(observed.status).toBe(201);

  return record;
}

/**
 * requests and completes an analysis of the record at its current revision
 * @param fixture authenticated HTTP fixture
 * @param recordId analysed record
 * @param revision displayed record revision
 * @returns completed run detail
 */
async function analyse(
  fixture: HttpFixture,
  recordId: string,
  revision: number,
): Promise<AnalysisRunDetail> {
  const accepted = analysisAcceptedSchema.parse(
    await (
      await fixture.request(
        `/v1/records/${recordId}/analyses`,
        'POST',
        { expectedRecordRevision: revision },
        randomUUID(),
      )
    ).json(),
  );
  expect(await fixture.runtime.drain()).toMatchObject({ failures: [] });

  return analysisRunDetailSchema.parse(
    await (await fixture.request(`/v1/analyses/${accepted.runId}`)).json(),
  );
}

/**
 * requests and completes an edit draft from the record's observations
 * @param fixture authenticated HTTP fixture
 * @param recordId edited record
 * @param revision displayed record revision
 * @returns ready draft detail
 */
async function draft(
  fixture: HttpFixture,
  recordId: string,
  revision: number,
): Promise<EditDraftDetail> {
  const observations = (await (
    await fixture.request(`/v1/records/${recordId}/observations`)
  ).json()) as { items: Array<{ id: string }> };
  const accepted = editDraftAcceptedSchema.parse(
    await (
      await fixture.request('/v1/edit-drafts', 'POST', {
        requestKey: randomUUID(),
        recordId,
        expectedRecordRevision: revision,
        transcriptionIds: [],
        observationIds: observations.items.map((item) => item.id),
        instructionZhHant: '整理描述',
      })
    ).json(),
  );
  expect(await fixture.runtime.drain()).toMatchObject({ failures: [] });

  return editDraftDetailSchema.parse(
    await (
      await fixture.request(`/v1/edit-drafts/${accepted.editDraftId}`)
    ).json(),
  );
}

/**
 * changes one record field through the collector's own edit
 * @param fixture authenticated HTTP fixture
 * @param change edited record, its current revision, and changed fields
 * @param change.recordId edited record
 * @param change.revision current record revision
 * @param change.fields changed fields
 */
async function edit(
  fixture: HttpFixture,
  {
    recordId,
    revision,
    fields,
  }: {
    readonly recordId: string;
    readonly revision: number;
    readonly fields: Record<string, unknown>;
  },
): Promise<void> {
  const patched = await fixture.request(
    `/v1/records/${recordId}`,
    'PATCH',
    { expectedRevision: revision, fields },
    randomUUID(),
  );
  expect(patched.status).toBe(200);
}

describe('analysis adoption guardrails', () => {
  it('should reject a stale screen once, then adopt despite an unadopted change, and never twice or for another owner', async ({
    fixture,
  }) => {
    const record = await createObservedRecord(fixture);
    const run = await analyse(fixture, record.id, 2);
    const proposal = run.result.output!.proposedChanges.find(
      (change) => change.field === 'description',
    )!;
    await edit(fixture, {
      recordId: record.id,
      revision: 2,
      fields: { name: 'Collector rename' },
    });
    const apply = async (revision: number): Promise<Response> =>
      fixture.request(
        `/v1/analyses/${run.runId}/apply`,
        'POST',
        {
          expectedRecordRevision: revision,
          selectedProposalIds: [proposal.id],
        },
        randomUUID(),
      );

    const stale = await apply(2);
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({
      code: 'REVISION_CONFLICT',
      retryable: true,
    });
    const foreign = await createAnalysisService(
      fixture.runtime.transaction,
      unusedCatalog,
      { role: 'analysis', modelId: 'development', profileVersion: '1' },
      clock,
      ids,
    ).apply(randomUUID(), run.runId, randomUUID(), {
      expectedRecordRevision: 3,
      selectedProposalIds: [proposal.id],
    });
    expect(foreign).toEqual({
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: 'Completed analysis not found',
        retryable: false,
      },
    });
    const adopted = await apply(3);
    expect(adopted.status).toBe(200);
    expect(await adopted.json()).toMatchObject({
      name: 'Collector rename',
      description: proposal.proposed,
      recordRevision: 4,
    });
    const reapplied = await apply(4);
    expect(reapplied.status).toBe(422);
    expect(await reapplied.json()).toMatchObject({ code: 'VALIDATION_FAILED' });
    const history = recordHistoryPageSchema.parse(
      await (await fixture.request(`/v1/records/${record.id}/history`)).json(),
    );
    expect(history).toMatchObject({
      items: [
        {
          field: 'description',
          before: proposal.before,
          after: proposal.proposed,
          status: 'accepted',
          source: {
            kind: 'analysis',
            runId: run.runId,
            proposalId: proposal.id,
          },
        },
      ],
      nextCursor: null,
    });
  });

  it('should reject adopting a field the collector changed after the analysis', async ({
    fixture,
  }) => {
    const record = await createObservedRecord(fixture);
    const run = await analyse(fixture, record.id, 2);
    const proposal = run.result.output!.proposedChanges.find(
      (change) => change.field === 'description',
    )!;
    await edit(fixture, {
      recordId: record.id,
      revision: 2,
      fields: { description: 'Collector rewrite' },
    });

    const conflict = await fixture.request(
      `/v1/analyses/${run.runId}/apply`,
      'POST',
      { expectedRecordRevision: 3, selectedProposalIds: [proposal.id] },
      randomUUID(),
    );
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({
      code: 'REVISION_CONFLICT',
      message: 'A proposed field changed since analysis',
      retryable: true,
    });
    expect(
      await (await fixture.request(`/v1/records/${record.id}/history`)).json(),
    ).toEqual({ items: [], nextCursor: null });
  });
});

describe('edit draft adoption guardrails', () => {
  it('should reject a stale screen once, then adopt despite an unadopted change, and never twice or for another owner', async ({
    fixture,
  }) => {
    const record = await createObservedRecord(fixture);
    const ready = await draft(fixture, record.id, 2);
    const proposal = ready.result!.proposedChanges.find(
      (change) => change.field === 'description',
    )!;
    await edit(fixture, {
      recordId: record.id,
      revision: 2,
      fields: { name: 'Collector rename' },
    });
    const apply = async (revision: number): Promise<Response> =>
      fixture.request(`/v1/edit-drafts/${ready.editDraftId}/apply`, 'POST', {
        requestKey: randomUUID(),
        expectedDraftRevision: ready.revision,
        expectedRecordRevision: revision,
        selectedProposalIds: [proposal.id],
      });

    const stale = await apply(2);
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({
      code: 'REVISION_CONFLICT',
      retryable: true,
    });
    const foreign = await createEditDraftService(
      fixture.runtime.transaction,
      { role: 'recordEditing', modelId: 'development', profileVersion: '1' },
      clock,
      ids,
    ).apply(randomUUID(), ready.editDraftId, {
      requestKey: randomUUID(),
      expectedDraftRevision: ready.revision,
      expectedRecordRevision: 3,
      selectedProposalIds: [proposal.id],
    });
    expect(foreign).toEqual({
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: 'Ready edit draft not found',
        retryable: false,
      },
    });
    const adopted = await apply(3);
    expect(adopted.status).toBe(200);
    expect(await adopted.json()).toMatchObject({
      record: { name: 'Collector rename', description: proposal.proposed },
    });
    const reapplied = await apply(4);
    expect(reapplied.status).toBe(404);
    expect(await reapplied.json()).toMatchObject({ code: 'NOT_FOUND' });
    expect(
      recordHistoryPageSchema.parse(
        await (
          await fixture.request(`/v1/records/${record.id}/history`)
        ).json(),
      ),
    ).toMatchObject({
      items: [
        {
          field: 'description',
          before: proposal.before,
          after: proposal.proposed,
          status: 'accepted',
          source: {
            kind: 'editDraft',
            editDraftId: ready.editDraftId,
            proposalId: proposal.id,
            recordMessageId: null,
          },
        },
      ],
      nextCursor: null,
    });
  });

  it('should reject adopting a field the collector changed after the draft', async ({
    fixture,
  }) => {
    const record = await createObservedRecord(fixture);
    const ready = await draft(fixture, record.id, 2);
    const proposal = ready.result!.proposedChanges.find(
      (change) => change.field === 'description',
    )!;
    await edit(fixture, {
      recordId: record.id,
      revision: 2,
      fields: { description: 'Collector rewrite' },
    });

    const conflict = await fixture.request(
      `/v1/edit-drafts/${ready.editDraftId}/apply`,
      'POST',
      {
        requestKey: randomUUID(),
        expectedDraftRevision: ready.revision,
        expectedRecordRevision: 3,
        selectedProposalIds: [proposal.id],
      },
    );
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({
      code: 'REVISION_CONFLICT',
      message: 'Proposed field changed since draft',
      retryable: true,
    });
  });
});

describe('fn:createRecordRoutes history', () => {
  it('should page both suggestion sources newest first', async ({
    fixture,
  }) => {
    const record = await createObservedRecord(fixture);
    const run = await analyse(fixture, record.id, 2);
    const skipped = run.result.output!.proposedChanges[0]!;
    const skip = await fixture.request(
      `/v1/analyses/${run.runId}/apply`,
      'POST',
      {
        expectedRecordRevision: 2,
        selectedProposalIds: [],
        skippedProposalIds: [skipped.id],
      },
      randomUUID(),
    );
    expect(skip.status).toBe(200);
    const ready = await draft(fixture, record.id, 3);
    const accepted = ready.result!.proposedChanges[0]!;
    const applied = await fixture.request(
      `/v1/edit-drafts/${ready.editDraftId}/apply`,
      'POST',
      {
        requestKey: randomUUID(),
        expectedDraftRevision: ready.revision,
        expectedRecordRevision: 3,
        selectedProposalIds: [accepted.id],
      },
    );
    expect(applied.status).toBe(200);

    const first = await fixture.request(
      `/v1/records/${record.id}/history?limit=1`,
    );
    expect(first.status).toBe(200);
    const firstPage = recordHistoryPageSchema.parse(await first.json());
    expect(firstPage.items).toMatchObject([
      {
        status: 'accepted',
        source: { kind: 'editDraft', editDraftId: ready.editDraftId },
      },
    ]);
    const second = recordHistoryPageSchema.parse(
      await (
        await fixture.request(
          `/v1/records/${record.id}/history?limit=1&cursor=${firstPage.nextCursor}`,
        )
      ).json(),
    );
    expect(second).toMatchObject({
      items: [
        {
          status: 'skipped',
          source: {
            kind: 'analysis',
            runId: run.runId,
            proposalId: skipped.id,
          },
        },
      ],
      nextCursor: null,
    });
  });

  it('should hide another owner record and missing records as not found', async ({
    fixture,
  }) => {
    const foreign = await createRecordService(
      fixture.runtime.transaction,
      clock,
      ids,
    ).create(randomUUID(), randomUUID(), { unitKind: 'single' });
    expect(foreign.success).toBe(true);

    for (const id of [foreign.success ? foreign.data.id : '', randomUUID()]) {
      const response = await fixture.request(`/v1/records/${id}/history`);
      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({
        code: 'NOT_FOUND',
        message: 'Record not found',
      });
    }
  });

  it.for([
    '/v1/records/missing/history',
    `/v1/records/${randomUUID()}/history?limit=0`,
    `/v1/records/${randomUUID()}/history?limit=101`,
  ])('should reject invalid history request %s', async (path, { fixture }) => {
    const response = await fixture.request(path);
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it.for([
    ['malformed', 'not-json'],
    [
      'tampered',
      Buffer.from(
        JSON.stringify({ occurredAt: 'yesterday', id: randomUUID() }),
      ).toString('base64url'),
    ],
  ] as const)(
    'should reject a %s history cursor for an owned record',
    async ([, cursor], { fixture }) => {
      const record = await createObservedRecord(fixture);
      const response = await fixture.request(
        `/v1/records/${record.id}/history?cursor=${cursor}`,
      );
      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({
        code: 'VALIDATION_FAILED',
        message: 'Invalid cursor',
        retryable: false,
      });
    },
  );
});
