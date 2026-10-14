import { randomUUID } from 'node:crypto';

import { inject, describe, expect } from 'vitest';

import { createHttpTest } from '../fixtures/http/test.js';

const resources = inject('httpResources');
const it = createHttpTest(resources['routes/research-http']!);

describe('Research HTTP boundaries', () => {
  it.for([
    ['POST', '/v1/search/images', {}],
    ['POST', '/v1/notes', {}],
    ['GET', '/v1/records/missing/references?limit=0', undefined],
  ] as const)(
    'should reject invalid %s %s',
    async ([method, path, body], { fixture }) => {
      const response = await fixture.request(path, method, body);
      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({
        code: 'VALIDATION_FAILED',
      });
    },
  );

  it('should refuse comparison of inaccessible collector evidence before any provider request', async ({
    fixture,
  }) => {
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
