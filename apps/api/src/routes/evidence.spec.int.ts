import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  knowledgeDetailSchema,
  observationSchema,
  recordCheckSchema,
  recordDetailSchema,
} from '@antica/contracts';

import { createHttpFixture } from '../fixtures/http.js';
import { knowledgeInput } from '../fixtures/knowledge.js';

let fixture: Awaited<ReturnType<typeof createHttpFixture>>;
beforeAll(async () => {
  fixture = await createHttpFixture();
}, 30_000);
afterAll(async () => {
  await fixture.close();
});

describe('fn:createEvidenceRoutes', () => {
  it('should persist a collector observation and revision-controlled method check through HTTP', async () => {
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

  it.each([
    ['POST', '/v1/evidence', {}, true],
    ['POST', '/v1/observations', {}, true],
    ['POST', '/v1/records/missing/checks', {}, true],
    ['PATCH', '/v1/checks/missing', {}, true],
    ['GET', '/v1/records/missing/observations?limit=0', undefined, false],
    ['GET', '/v1/records/missing/observations?limit=101', undefined, false],
    ['GET', '/v1/records/missing/observations?limit=1.5', undefined, false],
  ] as const)(
    'should reject invalid %s %s',
    async (...[method, path, body, hasKey]) => {
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

  it('should require idempotency keys on valid observation and check commands', async () => {
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

  it.each([
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
    async (body) => {
      const response = await fixture.request('/v1/evidence', 'POST', body);
      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({ code: 'NOT_FOUND' });
    },
  );
});
