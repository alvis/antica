import { randomUUID } from 'node:crypto';

import { inject, describe, expect } from 'vitest';

import { knowledgeDetailSchema } from '@antica/contracts';

import { createHttpTest } from '../fixtures/http/test.js';
import { knowledgeInput } from '../fixtures/knowledge.js';

const resources = inject('httpResources');
const it = createHttpTest(resources['routes/knowledge-http']!);

describe('Knowledge HTTP boundaries', () => {
  it('should apply explicit unknown-applicability and provenance filters', async ({
    fixture,
  }) => {
    const created = await fixture.request(
      '/v1/knowledge',
      'POST',
      knowledgeInput(),
    );
    expect(created.status).toBe(201);
    const detail = knowledgeDetailSchema.parse(await created.json());
    for (const query of ['', '?limit=1', '?includeUnknown=true']) {
      const response = await fixture.request(`/v1/knowledge${query}`);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        items: [expect.objectContaining({ id: detail.entry.id })],
      });
    }
    expect(
      await (
        await fixture.request('/v1/knowledge?includeUnknown=false')
      ).json(),
    ).toMatchObject({ items: [] });
    const sourceId = randomUUID();
    expect(
      await (
        await fixture.request(`/v1/knowledge?sourceIds=${sourceId}`)
      ).json(),
    ).toMatchObject({ items: [] });
    expect(
      await (
        await fixture.request(
          `/v1/knowledge?sourceIds=${sourceId}&includeUnknown=false`,
        )
      ).json(),
    ).toMatchObject({ items: [] });
  });

  it.for([
    ['POST', '/v1/sources', {}],
    ['GET', '/v1/sources/missing?limit=0', undefined],
    [
      'GET',
      `/v1/sources/missing?pageId=${randomUUID()}&pageCursor=next`,
      undefined,
    ],
    ['GET', '/v1/knowledge?includeUnknown=yes', undefined],
    ['GET', '/v1/knowledge?limit=0', undefined],
    ['POST', '/v1/knowledge', {}],
    ['GET', '/v1/knowledge/missing?revision=0', undefined],
    ['PATCH', '/v1/knowledge/missing', {}],
  ] as const)(
    'should reject invalid %s %s before returning private knowledge',
    async ([method, path, body], { fixture }) => {
      const response = await fixture.request(path, method, body);
      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({
        code: 'VALIDATION_FAILED',
      });
    },
  );
});
