import { createHash, randomUUID } from 'node:crypto';

import { inject, describe, expect } from 'vitest';

import {
  knowledgeDetailSchema,
  knowledgeEntryDetailV2Schema,
} from '@antica/contracts';

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

  it('should assign review provenance without saving and preserve immutable saved and historical reads', async ({
    fixture,
  }) => {
    const input = v2Input();
    input.reviewDecisions = [{ claimKey: 'body', state: 'reviewed' }];
    input.translationDecisions = [
      {
        claimKey: 'body',
        language: 'fr',
        kind: 'translation',
        state: 'reviewed',
      },
    ];
    const response = await fixture.request('/v1/knowledge', 'POST', input);
    expect(response.status).toBe(201);
    const first = knowledgeEntryDetailV2Schema.parse(await response.json());
    expect(first).toMatchObject({
      revision: 1,
      status: 'draft',
      savedBy: null,
    });
    expect(first.content.claims[0]!.review).toMatchObject({
      state: 'reviewed',
      actor: expect.any(String),
      at: expect.any(String),
    });
    expect(first.content.claims[0]!.variants[0]!.review).toEqual(
      first.content.claims[0]!.review,
    );
    expect(
      await (await fixture.request('/v1/knowledge', 'POST', input)).json(),
    ).toEqual(first);
    expect(
      (
        await fixture.request('/v1/knowledge', 'POST', {
          ...input,
          status: 'saved',
        })
      ).status,
    ).toBe(422);
    const url = `/v1/knowledge/${first.id}`;
    expect((await fixture.request(`${url}?view=saved`)).status).toBe(404);
    const save = {
      ...input,
      requestKey: randomUUID(),
      expectedRevision: 1,
      status: 'saved',
    };
    const savedResponse = await fixture.request(url, 'PATCH', save);
    expect(savedResponse.status).toBe(200);
    const saved = knowledgeEntryDetailV2Schema.parse(
      await savedResponse.json(),
    );
    expect(saved).toMatchObject({
      revision: 2,
      status: 'saved',
      savedBy: 'collector',
    });
    expect(await (await fixture.request(url, 'PATCH', save)).json()).toEqual(
      saved,
    );
    expect(
      (await fixture.request(url, 'PATCH', { ...save, status: 'draft' }))
        .status,
    ).toBe(422);
    const draft = await fixture.request(url, 'PATCH', {
      ...input,
      requestKey: randomUUID(),
      expectedRevision: 2,
    });
    expect(await draft.json()).toMatchObject({
      revision: 3,
      status: 'draft',
      savedBy: null,
    });
    for (const query of ['', '?view=working', '?locale=fr']) {
      expect(
        await (await fixture.request(`${url}${query}`)).json(),
      ).toMatchObject({ revision: 3 });
    }
    const savedRead = await fixture.request(`${url}?view=saved&locale=fr`);
    expect(await savedRead.json()).toEqual(saved);
    expect(savedRead.headers.get('etag')).toBe(`"2-${saved.contentHash}"`);
    expect(
      await (await fixture.request(`${url}?view=revision&revision=1`)).json(),
    ).toEqual(first);
    expect(
      (await fixture.request(`${url}?view=revision&revision=99`)).status,
    ).toBe(404);
    expect(
      (
        await fixture.request(url, 'PATCH', {
          ...save,
          requestKey: randomUUID(),
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await fixture.request(`/v1/knowledge/${randomUUID()}`, 'PATCH', {
          ...save,
          requestKey: randomUUID(),
        })
      ).status,
    ).toBe(404);
  });

  it('should save only an explicit saved creation and attribute editorial rejection to the collector', async ({
    fixture,
  }) => {
    const input = v2Input();
    input.status = 'saved';
    input.content.editorialReview = { state: 'rejected' };
    input.reviewDecisions = [{ claimKey: 'body', state: 'rejected' }];
    const response = await fixture.request('/v1/knowledge', 'POST', input);
    expect(response.status).toBe(201);
    const detail = knowledgeEntryDetailV2Schema.parse(await response.json());
    expect(detail).toMatchObject({
      status: 'saved',
      savedBy: 'collector',
      revision: 1,
    });
    expect(detail.content.editorialReview).toEqual(
      detail.content.claims[0]!.review,
    );
    expect(detail.content.editorialReview).toMatchObject({
      state: 'rejected',
      actor: expect.any(String),
      at: expect.any(String),
    });
    expect(
      await (
        await fixture.request(`/v1/knowledge/${detail.id}?view=saved`)
      ).json(),
    ).toEqual(detail);
  });

  it('should invalidate translation review when its source text changes', async ({
    fixture,
  }) => {
    const input = v2Input();
    input.content.claims[0]!.variants[0]!.sourceTextHash = 'a'.repeat(64);
    input.content.claims[0]!.variants[0]!.review = { state: 'reviewed' };
    const response = await fixture.request('/v1/knowledge', 'POST', input);
    expect(response.status).toBe(201);
    const detail = knowledgeEntryDetailV2Schema.parse(await response.json());
    expect(detail.content.claims[0]!.variants[0]!.review).toEqual({
      state: 'pending',
    });
  });

  it.for([
    'unknown claim',
    'duplicate claim',
    'unknown variant',
    'unknown translation claim',
    'duplicate translation',
    'stale translation',
  ] as const)(
    'should reject %s review decisions without creating a revision',
    async (scenario, { fixture }) => {
      const input = v2Input();
      const claimDecision = { claimKey: 'body', state: 'reviewed' as const };
      const translation = {
        claimKey: 'body',
        language: 'fr',
        kind: 'translation' as const,
        state: 'reviewed' as const,
      };
      if (scenario === 'unknown claim') {
        input.reviewDecisions = [{ ...claimDecision, claimKey: 'missing' }];
      }
      if (scenario === 'duplicate claim') {
        input.reviewDecisions = [claimDecision, claimDecision];
      }
      if (scenario === 'unknown variant') {
        input.translationDecisions = [{ ...translation, language: 'de' }];
      }
      if (scenario === 'unknown translation claim') {
        input.translationDecisions = [{ ...translation, claimKey: 'missing' }];
      }
      if (scenario === 'duplicate translation') {
        input.translationDecisions = [translation, translation];
      }
      if (scenario === 'stale translation') {
        input.content.claims[0]!.variants[0]!.sourceTextHash = 'a'.repeat(64);
        input.translationDecisions = [translation];
      }
      expect(
        (await fixture.request('/v1/knowledge', 'POST', input)).status,
      ).toBe(422);
      const valid = await fixture.request('/v1/knowledge', 'POST', v2Input());
      const detail = knowledgeEntryDetailV2Schema.parse(await valid.json());
      expect(
        (
          await fixture.request(`/v1/knowledge/${detail.id}`, 'PATCH', {
            ...input,
            expectedRevision: 1,
          })
        ).status,
      ).toBe(422);
      expect(
        await (await fixture.request(`/v1/knowledge/${detail.id}`)).json(),
      ).toEqual(detail);
    },
  );

  it('should keep legacy drafts unsaved and preserve the saved revision after a newer draft', async ({
    fixture,
  }) => {
    const input = knowledgeInput();
    const created = await fixture.request('/v1/knowledge', 'POST', input);
    expect(created.status).toBe(201);
    const draft = knowledgeDetailSchema.parse(await created.json());
    expect(draft.entry).toMatchObject({
      revision: 1,
      status: 'draft',
      savedBy: null,
    });
    const url = `/v1/knowledge/${draft.entry.id}`;
    const methodUrl = `${url}?methodVersionId=${draft.methodVersions[0]!.id}`;
    const methodRead = await fixture.request(methodUrl);
    expect(methodRead.status).toBe(200);
    expect(await methodRead.json()).toEqual(draft);
    expect(methodRead.headers.get('etag')).toMatch(/^"1-[a-f0-9]{64}"$/);
    expect(
      (await fixture.request(`${url}?methodVersionId=${randomUUID()}`)).status,
    ).toBe(404);

    const saved = await fixture.request(url, 'PATCH', {
      ...input,
      requestKey: randomUUID(),
      expectedRevision: 1,
      status: 'saved',
      methodWrites: [],
    });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({
      entry: { revision: 2, status: 'saved', savedBy: 'collector' },
    });
    const edited = await fixture.request(url, 'PATCH', {
      ...input,
      requestKey: randomUUID(),
      expectedRevision: 2,
      methodWrites: [],
      content: { ...input.content, titleZhHant: 'New working title' },
    });
    expect(edited.status).toBe(200);
    expect(await edited.json()).toMatchObject({
      entry: { revision: 3, status: 'draft', savedBy: null },
    });
    const savedRead = await fixture.request(`${url}?view=saved`);
    expect(await savedRead.json()).toMatchObject({
      entry: {
        revision: 2,
        status: 'saved',
        content: { titleZhHant: input.content.titleZhHant },
      },
    });
    expect(savedRead.headers.get('etag')).toMatch(/2.*[a-f0-9]{64}/);
    expect(
      await (await fixture.request(`${url}?view=working`)).json(),
    ).toMatchObject({ entry: { revision: 3 } });
    expect(await (await fixture.request(url)).json()).toMatchObject({
      entry: { revision: 3 },
    });
    expect(
      await (await fixture.request(`${url}?view=revision&revision=1`)).json(),
    ).toMatchObject({ entry: { revision: 1, savedBy: null } });
    expect(
      (await fixture.request(`${url}?view=revision&revision=99`)).status,
    ).toBe(404);
    expect(
      (
        await fixture.request(url, 'PATCH', {
          ...input,
          requestKey: randomUUID(),
          expectedRevision: 1,
          methodWrites: [],
        })
      ).status,
    ).toBe(409);
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

function v2Input(): import('@antica/contracts').KnowledgeWriteV2 {
  const text = 'A body observation';

  return {
    requestKey: randomUUID(),
    expectedRevision: null,
    status: 'draft',
    reviewDecisions: [],
    translationDecisions: [],
    content: {
      contentSchemaVersion: 2,
      entryType: 'concept',
      origin: 'collector',
      titles: [{ language: 'en', text: 'Porcelain' }],
      aliases: [],
      sections: {
        summary: {
          claimKey: 'body',
          text,
          citationIds: [],
          supportState: 'needs_source',
        },
        history: [],
        features: [],
        applicability: [],
        limits: [],
      },
      claims: [
        {
          claimKey: 'body',
          section: 'summary',
          ordinal: 0,
          originalText: text,
          originalLanguage: 'en',
          statementType: 'observation',
          scope: {},
          qualifiers: {},
          supportState: 'needs_source',
          citationIds: [],
          review: { state: 'pending' },
          variants: [
            {
              language: 'fr',
              kind: 'translation',
              text: 'Une observation',
              method: 'human',
              sourceTextHash: createHash('sha256').update(text).digest('hex'),
              review: { state: 'pending' },
            },
          ],
        },
      ],
      topics: [],
      citations: [],
      images: [],
      methodIds: [],
      relatedEntryIds: [],
      editorialReview: { state: 'pending' },
    },
  };
}
