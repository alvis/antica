import { randomUUID } from 'node:crypto';

import { inject, describe, expect } from 'vitest';

import {
  analysisAcceptedSchema,
  analysisRunDetailSchema,
  recordDetailSchema,
} from '@antica/contracts';

import { createHttpTest } from '../fixtures/http/test.js';

const resources = inject('httpResources');
const it = createHttpTest(resources['routes/analysis']!);

describe('fn:createAnalysisRoutes', () => {
  it('should freeze explicit analysis, preserve the record until adoption, and retain action dismissal', async ({
    fixture,
  }) => {
    const record = recordDetailSchema.parse(
      await (
        await fixture.request(
          '/v1/records',
          'POST',
          { unitKind: 'single', description: 'Collector description' },
          randomUUID(),
        )
      ).json(),
    );
    await fixture.request(
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
    const key = randomUUID();
    const requested = await fixture.request(
      `/v1/records/${record.id}/analyses`,
      'POST',
      { expectedRecordRevision: 2 },
      key,
    );
    expect(requested.status).toBe(202);
    const accepted = analysisAcceptedSchema.parse(await requested.json());
    expect(
      await (
        await fixture.request(
          `/v1/records/${record.id}/analyses`,
          'POST',
          { expectedRecordRevision: 2 },
          key,
        )
      ).json(),
    ).toEqual(accepted);
    expect(await fixture.runtime.drain()).toMatchObject({
      settled: 1,
      failures: [],
    });
    const detail = analysisRunDetailSchema.parse(
      await (await fixture.request(`/v1/analyses/${accepted.runId}`)).json(),
    );
    expect(detail).toMatchObject({
      status: 'completed',
      snapshot: { recordRevision: 2 },
      invocation: { adapterKind: 'development' },
    });
    expect(
      await (await fixture.request(`/v1/records/${record.id}`)).json(),
    ).toMatchObject({ description: record.description, recordRevision: 2 });
    const proposal = detail.result.output!.proposedChanges[0]!;
    const applied = await fixture.request(
      `/v1/analyses/${accepted.runId}/apply`,
      'POST',
      { expectedRecordRevision: 2, selectedProposalIds: [proposal.id] },
      randomUUID(),
    );
    expect(applied.status).toBe(200);
    expect(
      await (await fixture.request(`/v1/records/${record.id}`)).json(),
    ).toMatchObject({
      description: 'Collector description\n釉面粗糙',
      recordRevision: 3,
    });
    const action = detail.result.output!.nextActions[0]!;
    const dismissed = await fixture.request(
      `/v1/analyses/${accepted.runId}/actions/${action.id}`,
      'PATCH',
      {
        expectedActionRevision: 1,
        expectedRecordRevision: 3,
        status: 'dismissed',
        reason: 'Already recorded on site',
      },
      randomUUID(),
    );
    expect(dismissed.status).toBe(200);
    expect(await dismissed.json()).toMatchObject({
      state: { status: 'dismissed' },
      resolution: { reason: 'Already recorded on site' },
    });
    expect(
      await (
        await fixture.request(
          `/v1/tasks?recordId=${record.id}&limit=1&actionStatus=dismissed`,
        )
      ).json(),
    ).toMatchObject({
      items: [
        expect.objectContaining({
          kind: 'analysisAction',
          state: expect.objectContaining({ status: 'dismissed' }),
        }),
      ],
    });
    expect((await fixture.request('/v1/tasks')).status).toBe(200);
  });

  it.for([
    ['POST', '/v1/records/missing/analyses', {}, true],
    [
      'POST',
      '/v1/records/missing/analyses',
      { expectedRecordRevision: 1 },
      false,
    ],
    ['POST', '/v1/analyses/missing/apply', {}, true],
    [
      'POST',
      '/v1/analyses/missing/apply',
      { expectedRecordRevision: 1, selectedProposalIds: [] },
      false,
    ],
    ['PATCH', '/v1/analyses/missing/actions/missing', {}, true],
    [
      'PATCH',
      '/v1/analyses/missing/actions/missing',
      {
        expectedRecordRevision: 1,
        expectedActionRevision: 1,
        status: 'dismissed',
        reason: 'Not relevant',
      },
      false,
    ],
    ['GET', '/v1/tasks?limit=0', undefined, false],
  ] as const)(
    'should reject invalid %s %s without scheduling work',
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
      expect(await fixture.runtime.drain()).toMatchObject({ inspected: 0 });
    },
  );
});
