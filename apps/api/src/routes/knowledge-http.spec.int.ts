import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { knowledgeDetailSchema } from '@antica/contracts';

import { createHttpFixture } from '../fixtures/http.js';
import { knowledgeInput } from '../fixtures/knowledge.js';

let fixture: Awaited<ReturnType<typeof createHttpFixture>>;
beforeAll(async () => {
  fixture = await createHttpFixture();
}, 30_000);
afterAll(async () => {
  await fixture.close();
});

describe('Knowledge HTTP boundaries', () => {
  it('should apply explicit unknown-applicability and provenance filters', async () => {
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

  it.each([
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
    async (method, path, body) => {
      const response = await fixture.request(path, method, body);
      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({
        code: 'VALIDATION_FAILED',
      });
    },
  );
});
