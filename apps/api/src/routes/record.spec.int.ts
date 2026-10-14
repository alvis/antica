import { randomUUID } from 'node:crypto';

import { inject, describe, expect } from 'vitest';

import { recordDetailSchema } from '@antica/contracts';

import { createHttpTest } from '../fixtures/http/test.js';

const resources = inject('httpResources');
const it = createHttpTest(resources['routes/record']!);

describe('fn:createRecordRoutes', () => {
  it('should persist an idempotent create and revision-checked patch through the authenticated API', async ({
    fixture,
  }) => {
    const key = randomUUID();
    const input = { unitKind: 'single', name: 'Celadon / 青釉瓶' };
    const created = await fixture.request('/v1/records', 'POST', input, key);
    expect(created.status).toBe(201);
    const record = recordDetailSchema.parse(await created.json());
    expect(record).toMatchObject({ name: input.name, recordRevision: 1 });
    expect(
      await (await fixture.request('/v1/records', 'POST', input, key)).json(),
    ).toEqual(record);
    const patched = await fixture.request(
      `/v1/records/${record.id}`,
      'PATCH',
      { expectedRevision: 1, fields: { name: 'Collector correction' } },
      randomUUID(),
    );
    expect(patched.status).toBe(200);
    const updated = recordDetailSchema.parse(await patched.json());
    expect(updated).toMatchObject({
      name: 'Collector correction',
      recordRevision: 2,
    });
    expect(
      await (await fixture.request(`/v1/records/${record.id}`)).json(),
    ).toEqual(updated);
    const stale = await fixture.request(
      `/v1/records/${record.id}`,
      'PATCH',
      { expectedRevision: 1, fields: { name: 'Stale edit' } },
      randomUUID(),
    );
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ code: 'REVISION_CONFLICT' });
    const list = await fixture.request(
      '/v1/records?limit=1&hasPendingChecks=false&text=Collector&sort=name',
    );
    expect(list.status).toBe(200);
    expect(await list.json()).toMatchObject({
      items: [{ id: record.id, name: updated.name }],
    });
    expect((await fixture.request('/v1/records')).status).toBe(200);
  });

  it.for([
    ['POST', '/v1/records', {}, true],
    ['POST', '/v1/records', { unitKind: 'single' }, false],
    ['PATCH', '/v1/records/missing', {}, true],
    [
      'PATCH',
      '/v1/records/missing',
      { expectedRevision: 1, fields: { name: 'changed' } },
      false,
    ],
    ['GET', '/v1/records?limit=0', undefined, false],
  ] as const)(
    'should reject invalid %s %s without changing the collection',
    async ([method, path, input, hasKey], { fixture }) => {
      const before = await (await fixture.request('/v1/records')).json();
      const response = await fixture.request(
        path,
        method,
        input,
        hasKey ? randomUUID() : undefined,
      );
      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({
        code: 'VALIDATION_FAILED',
        retryable: false,
      });
      expect(await (await fixture.request('/v1/records')).json()).toEqual(
        before,
      );
    },
  );
});
