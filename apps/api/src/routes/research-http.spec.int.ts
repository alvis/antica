import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createHttpFixture } from '../fixtures/http.js';

let fixture: Awaited<ReturnType<typeof createHttpFixture>>;
beforeAll(async () => {
  fixture = await createHttpFixture();
}, 30_000);
afterAll(async () => {
  await fixture.close();
});

describe('Research HTTP boundaries', () => {
  it.each([
    ['POST', '/v1/search/images', {}],
    ['POST', '/v1/notes', {}],
    ['GET', '/v1/records/missing/references?limit=0', undefined],
  ] as const)('should reject invalid %s %s', async (method, path, body) => {
    const response = await fixture.request(path, method, body);
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('should refuse comparison of inaccessible collector evidence before any provider request', async () => {
    const response = await fixture.request('/v1/search/images', 'POST', {
      mode: 'compare',
      queryAnchorId: randomUUID(),
      selected: {
        kind: 'collection',
        recordId: randomUUID(),
        originalAssetId: randomUUID(),
      },
      selectedRegion: null,
      selectedCanonicalViewId: null,
    });
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ code: 'EVIDENCE_INVALID' });
  });
});
