import { randomUUID } from 'node:crypto';

import { describe, expect, inject } from 'vitest';

import {
  knowledgeDetailSchema,
  knowledgeEntryDetailV2Schema,
} from '@antica/contracts';

import { readKnowledgeConfiguration } from '@antica/platform';

import { readImageConfiguration } from '../configuration.js';
import { createHttpTest } from '../fixtures/http/test.js';
import { knowledgeInput } from '../fixtures/knowledge.js';
import { createLocalSettings } from '../fixtures/runtime.js';

import type { KnowledgeWriteV2 } from '@antica/contracts';

const resources = inject('httpResources');
const knowledge = readKnowledgeConfiguration({ NODE_ENV: 'production' });
const image = readImageConfiguration({ NODE_ENV: 'production' });
if (!knowledge.success || !image.success) {
  throw new Error('Optional drivers must not block startup');
}
const it = createHttpTest(resources['routes/knowledge-search']!, {
  ...createLocalSettings(),
  knowledge: knowledge.data,
  image: image.data,
});

describe('Knowledge discovery HTTP boundaries', () => {
  it('should default to saved discovery and require authenticated ownership for working drafts', async ({
    fixture,
  }) => {
    const created = await fixture.request('/v1/knowledge', 'POST', draft());
    expect(created.status).toBe(201);
    const detail = knowledgeEntryDetailV2Schema.parse(await created.json());
    const saved = await fixture.request('/v1/knowledge/search');
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({ total: 0, hits: [] });
    const working = await fixture.request(
      '/v1/knowledge/search?view=working&locale=en',
    );
    expect(working.status).toBe(200);
    expect(await working.json()).toMatchObject({
      total: 1,
      hits: [
        expect.objectContaining({
          id: detail.id,
          revision: 1,
          saved: false,
          excerpt: null,
        }),
      ],
    });
    expect(
      (
        await fixture.runtime.app.request(
          'http://127.0.0.1:8080/v1/knowledge/search?view=working',
        )
      ).status,
    ).toBe(401);
    const topics = await fixture.request('/v1/knowledge/topics');
    expect(topics.status).toBe(200);
    expect(await topics.json()).toMatchObject({ items: [], total: 0 });
  });

  it('should include real session SQL in search, topic and detail request budgets', async ({
    fixture,
  }) => {
    const created = await fixture.request('/v1/knowledge', 'POST', draft());
    const detail = knowledgeEntryDetailV2Schema.parse(await created.json());
    const owner = await fixture.runtime.database.db.session.findFirstOrThrow();
    const topicId = randomUUID();
    await fixture.runtime.database.db.topic.create({
      data: {
        id: topicId,
        ownerId: owner.userId,
        contentId: `test:${topicId}`,
        facet: 'category',
      },
    });
    const statements: string[] = [];
    fixture.runtime.database.db.$on('query', (event) =>
      statements.push(event.query),
    );
    const cases = [
      { path: '/v1/knowledge/search?view=working', budget: 2 },
      { path: '/v1/knowledge/topics', budget: 2 },
      { path: `/v1/knowledge/topics/${topicId}/tree`, budget: 2 },
      { path: `/v1/knowledge/${detail.id}?view=working`, budget: 3 },
    ];
    for (const item of cases) {
      const before = statements.length;
      const response = await fixture.request(item.path);
      expect(response.status).toBe(200);
      const sql = statements.slice(before);
      expect(
        { path: item.path, statements: sql.length },
        JSON.stringify(sql),
      ).toEqual({
        path: item.path,
        statements: 2,
      });
      expect(sql.length).toBeLessThanOrEqual(item.budget);
      expect(sql.some((query) => query.includes('session'))).toBe(true);
    }
  });

  it('should fill natural-language best matches within two statements including fresh authentication', async ({
    fixture,
  }) => {
    const created = await fixture.request('/v1/knowledge', 'POST', draft());
    const detail = knowledgeEntryDetailV2Schema.parse(await created.json());
    const statements: string[] = [];
    fixture.runtime.database.db.$on('query', (event) =>
      statements.push(event.query),
    );
    const response = await fixture.request(
      '/v1/knowledge/search?view=working&q=how%20porcelain%20jade',
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      hits: expect.arrayContaining([
        expect.objectContaining({
          id: detail.id,
          matchReason: 'best_match',
          matchedTokens: ['porcelain'],
        }),
      ]),
    });
    expect(statements).toHaveLength(2);
    expect(statements.some((query) => query.includes('session'))).toBe(true);
  });

  it('should preserve legacy detail and bound missing and foreign detail requests', async ({
    fixture,
  }) => {
    const created = await fixture.request(
      '/v1/knowledge',
      'POST',
      knowledgeInput(),
    );
    expect(created.status).toBe(201);
    const legacy = (await created.json()) as { entry: { id: string } };
    const baseline = await fixture.request(`/v1/knowledge/${legacy.entry.id}`);
    const expected = knowledgeDetailSchema.parse(await baseline.json());
    const statements: string[] = [];
    fixture.runtime.database.db.$on('query', (event) =>
      statements.push(event.query),
    );
    const detail = await fixture.request(
      `/v1/knowledge/${legacy.entry.id}?view=working`,
    );
    expect(detail.status).toBe(200);
    expect(await detail.json()).toEqual(expected);
    expect(statements).toHaveLength(2);
    const methodVersionId = expected.methodVersions[0]!.id;
    const beforeMethod = statements.length;
    const method = await fixture.request(
      `/v1/knowledge/${legacy.entry.id}?methodVersionId=${methodVersionId}`,
    );
    expect(method.status).toBe(200);
    expect(await method.json()).toEqual(expected);
    expect(statements.length - beforeMethod).toBe(2);
    expect(
      (
        await fixture.request(
          `/v1/knowledge/${legacy.entry.id}?methodVersionId=${randomUUID()}`,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await fixture.request(
          `/v1/knowledge/${randomUUID()}?methodVersionId=${methodVersionId}`,
        )
      ).status,
    ).toBe(404);
    const v2 = knowledgeEntryDetailV2Schema.parse(
      await (await fixture.request('/v1/knowledge', 'POST', draft())).json(),
    );
    expect(
      (
        await fixture.request(
          `/v1/knowledge/${v2.id}?methodVersionId=${methodVersionId}`,
        )
      ).status,
    ).toBe(404);
    const beforeMissing = statements.length;
    const missing = await fixture.request(
      `/v1/knowledge/${randomUUID()}?view=saved`,
    );
    expect(missing.status).toBe(404);
    expect(statements.length - beforeMissing).toBe(2);
    await fixture.runtime.database.db.knowledgeEntries.update({
      where: { id: legacy.entry.id },
      data: { ownerId: randomUUID() },
    });
    const beforeForeign = statements.length;
    const foreign = await fixture.request(
      `/v1/knowledge/${legacy.entry.id}?view=working`,
    );
    expect(foreign.status).toBe(404);
    expect(statements.length - beforeForeign).toBe(2);
  });

  it('should immediately deny revoked, expired and foreign-owner sessions and reject tampered cookies', async ({
    fixture,
  }) => {
    const db = fixture.runtime.database.db;
    const session = await db.session.findFirstOrThrow();
    const owner = await db.user.findUniqueOrThrow({
      where: { id: session.userId },
    });
    const foreign = {
      ...owner,
      id: randomUUID(),
      email: `${randomUUID()}@example.invalid`,
      phoneNumber: '+447700900999',
    };
    await db.user.create({ data: foreign });
    try {
      await db.session.delete({ where: { id: session.id } });
      expect(
        (await fixture.request('/v1/knowledge/search?view=working')).status,
      ).toBe(401);
      await db.session.create({
        data: { ...session, expiresAt: new Date('2000-01-01T00:00:00.000Z') },
      });
      expect(
        (await fixture.request('/v1/knowledge/search?view=working')).status,
      ).toBe(401);
      await db.session.upsert({
        where: { id: session.id },
        create: { ...session, userId: foreign.id },
        update: { ...session, userId: foreign.id },
      });
      expect(
        (await fixture.request('/v1/knowledge/search?view=working')).status,
      ).toBe(401);
      expect(
        (
          await fixture.runtime.app.request(
            'http://127.0.0.1:8080/v1/knowledge/search?view=working',
            {
              headers: {
                cookie: `better-auth.session_token=${session.token}.tampered`,
              },
            },
          )
        ).status,
      ).toBe(401);
    } finally {
      await db.session.upsert({
        where: { id: session.id },
        create: session,
        update: session,
      });
      await db.user.delete({ where: { id: foreign.id } });
    }
    expect(
      (await fixture.request('/v1/knowledge/search?view=working')).status,
    ).toBe(200);
  });

  it('should retain Better Auth session refresh and record its additional write', async ({
    fixture,
  }) => {
    const db = fixture.runtime.database.db;
    const session = await db.session.findFirstOrThrow();
    const statements: string[] = [];
    db.$on('query', (event) => statements.push(event.query));
    try {
      await db.session.update({
        where: { id: session.id },
        data: {
          expiresAt: new Date(Date.now() + 60_000),
          updatedAt: new Date(Date.now() - 172_800_000),
        },
      });
      const before = statements.length;
      const response = await fixture.request('/v1/knowledge/search');
      expect(response.status).toBe(200);
      const requestSql = statements.slice(before);
      expect(requestSql).toHaveLength(3);
      expect(requestSql.some((query) => query.startsWith('UPDATE'))).toBe(true);
      const refreshed = await db.session.findUniqueOrThrow({
        where: { id: session.id },
      });
      expect(refreshed.expiresAt.getTime()).toBeGreaterThan(
        Date.now() + 60_000,
      );
    } finally {
      await db.session.update({ where: { id: session.id }, data: session });
    }
  });

  it('should reject invalid search and topic bounds without treating static routes as entry identifiers', async ({
    fixture,
  }) => {
    const topicId = randomUUID();
    const invalidQueries = [
      '/v1/knowledge/search?limit=51',
      '/v1/knowledge/search?limit=0',
      '/v1/knowledge/search?locale=zh-Hans',
      '/v1/knowledge/search?view=revision',
      '/v1/knowledge/search?unknown=true',
      `/v1/knowledge/search?q=${encodeURIComponent('𠮷'.repeat(161))}`,
      '/v1/knowledge/search?topics=not-json',
      '/v1/knowledge/topics?limit=101',
      '/v1/knowledge/topics?locale=fr',
      `/v1/knowledge/topics/${topicId}/tree?depth=4`,
      `/v1/knowledge/topics/${topicId}/tree?childrenLimit=101`,
      '/v1/knowledge/topics/not-a-uuid/tree',
    ];
    for (const path of invalidQueries) {
      const response = await fixture.request(path);
      expect({ path, status: response.status }).toEqual({ path, status: 422 });
      expect(await response.json()).toMatchObject({
        code: 'VALIDATION_FAILED',
      });
    }
    expect(
      (
        await fixture.request(
          `/v1/knowledge/search?q=${encodeURIComponent('𠮷'.repeat(160))}`,
        )
      ).status,
    ).toBe(200);
  });
});

/** @returns a draft with searchable text that cannot be used as factual evidence */
function draft(): KnowledgeWriteV2 {
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
          text: 'Observation',
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
          originalText: 'Observation',
          originalLanguage: 'en',
          statementType: 'observation',
          scope: {},
          qualifiers: {},
          supportState: 'needs_source',
          citationIds: [],
          review: { state: 'pending' },
          variants: [],
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
