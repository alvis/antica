import { randomUUID } from 'node:crypto';

import { describe, expect, inject } from 'vitest';

import { createKnowledgeService } from '@antica/application/server';

import {
  knowledgeDetailSchema,
  relatedKnowledgePageSchema,
  knowledgeEntryDetailV2Schema,
} from '@antica/contracts';

import { readKnowledgeConfiguration } from '@antica/platform';

import { readImageConfiguration } from '../configuration.js';
import { createHttpTest } from '../fixtures/http/test.js';
import { knowledgeInput } from '../fixtures/knowledge.js';
import { createLocalSettings } from '../fixtures/runtime.js';

import {
  citedEnvelope,
  createRelatedEntry,
  createRelatedRecord,
  relatedContent,
  snapshotRelatedRows,
} from './knowledge-search/related.spec.helpers.js';

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

describe('Record-related saved knowledge', () => {
  it('should match exact saved names, cap cards, localize with fallback and preserve every row within two SQL statements', async ({
    fixture,
  }) => {
    const title = `Ceramic ${randomUUID()}`;
    const record = await createRelatedRecord(fixture, { name: title });
    const ids: string[] = [];
    for (let index = 0; index < 4; index += 1) {
      ids.push(await createRelatedEntry(fixture, relatedContent(title)));
    }
    const db = fixture.runtime.database.db;
    const before = await snapshotRelatedRows(db);
    const statements: string[] = [];
    db.$on('query', (event) => statements.push(event.query));
    const response = await fixture.request(
      `/v1/records/${record.id}/related-knowledge?locale=zh-Hant&recordRevision=1`,
    );
    expect(response.status).toBe(200);
    const page = relatedKnowledgePageSchema.parse(await response.json());
    expect(statements, JSON.stringify(statements)).toHaveLength(2);
    expect(statements.some((query) => query.includes('session'))).toBe(true);
    expect(page).toMatchObject({ recordRevision: 1, cards: expect.any(Array) });
    expect(page.cards).toHaveLength(3);
    expect(page.cards.map((card) => card.entryId)).toEqual(
      ids.toSorted().slice(0, 3),
    );
    expect(page.cards[0]).toMatchObject({
      title,
      revision: 1,
      language: 'en',
      fallback: true,
      kind: 'concept',
      excerpt: null,
      matches: [
        expect.objectContaining({ field: 'name', value: title, topicId: null }),
      ],
    });
    const limited = relatedKnowledgePageSchema.parse(
      await (
        await fixture.request(
          `/v1/records/${record.id}/related-knowledge?locale=en&limit=1`,
        )
      ).json(),
    );
    expect(limited.cards).toHaveLength(1);
    expect(limited.cards[0]).toMatchObject({ language: 'en', fallback: false });
    expect(limited.contextHash).toBe(page.contextHash);
    expect(await snapshotRelatedRows(db)).toEqual(before);
  });

  it('should normalize compatibility width, combining marks and Unicode whitespace using the search tokenizer', async ({
    fixture,
  }) => {
    const identity = randomUUID();
    const title = `Café ${identity}`;
    const entryId = await createRelatedEntry(fixture, relatedContent(title));
    const name = `\uFEFFＣＡＦＥ\u1AB0 ${identity.toUpperCase()}\uFEFF`;
    const record = await createRelatedRecord(fixture, { name });
    const response = await fixture.request(
      `/v1/records/${record.id}/related-knowledge?locale=en`,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      cards: [
        {
          entryId,
          title,
          matches: [
            expect.objectContaining({
              field: 'name',
              value: name,
              matchedTokens: expect.arrayContaining(['cafe']),
            }),
          ],
        },
      ],
    });
  });

  it('should use the saved head and exclude draft-only and weak lexical matches', async ({
    fixture,
  }) => {
    const title = `Bronze ${randomUUID()}`;
    const record = await createRelatedRecord(fixture, { name: title });
    const saved = await createRelatedEntry(fixture, relatedContent(title));
    await createRelatedEntry(fixture, relatedContent(title), 'draft');
    await createRelatedEntry(
      fixture,
      relatedContent(`${title} unrelated fragment`),
    );
    const db = fixture.runtime.database.db;
    const { userId } = await db.session.findFirstOrThrow();
    const { transaction, clock, ids } = fixture.runtime;
    const updated = await createKnowledgeService(
      transaction,
      clock,
      ids,
    ).updateV2(userId, saved, {
      requestKey: randomUUID(),
      expectedRevision: 1,
      content: relatedContent('Unsaved replacement'),
      status: 'draft',
      reviewDecisions: [],
      translationDecisions: [],
    });
    expect(updated.success).toBe(true);
    const response = await fixture.request(
      `/v1/records/${record.id}/related-knowledge`,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      cards: [{ entryId: saved, revision: 1, title, excerpt: null }],
    });
    const unsaved = await createRelatedRecord(fixture, {
      name: 'Unsaved replacement',
    });
    expect(
      await (
        await fixture.request(`/v1/records/${unsaved.id}/related-knowledge`)
      ).json(),
    ).toMatchObject({ cards: [], reason: 'no_match' });
  });

  it('should reject malformed bounds and stale revisions while keeping record reads available', async ({
    fixture,
  }) => {
    const record = await createRelatedRecord(fixture, {
      name: `Unmatched ${randomUUID()}`,
    });
    const path = `/v1/records/${record.id}/related-knowledge`;
    for (const query of [
      'limit=0',
      'limit=4',
      'limit=1.5',
      'limit=abc',
      'locale=fr',
      'recordRevision=0',
      'recordRevision=1.5',
      'recordRevision=abc',
      'unknown=true',
    ]) {
      const response = await fixture.request(`${path}?${query}`);
      expect({ query, status: response.status }).toEqual({
        query,
        status: 422,
      });
      expect(await response.json()).toMatchObject({
        code: 'VALIDATION_FAILED',
      });
    }
    expect(
      (await fixture.request('/v1/records/not-a-uuid/related-knowledge'))
        .status,
    ).toBe(422);
    const stale = await fixture.request(`${path}?recordRevision=2`);
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ code: 'REVISION_CONFLICT' });
    expect(
      await (await fixture.request(`/v1/records/${record.id}`)).json(),
    ).toEqual(record);
    const current = relatedKnowledgePageSchema.parse(
      await (await fixture.request(`${path}?recordRevision=1`)).json(),
    );
    expect(current).toMatchObject({
      cards: [],
      recordRevision: 1,
      reason: 'no_match',
    });
    const patched = await fixture.request(
      `/v1/records/${record.id}`,
      'PATCH',
      { expectedRevision: 1, fields: { name: `Changed ${randomUUID()}` } },
      randomUUID(),
    );
    expect(patched.status).toBe(200);
    const next = relatedKnowledgePageSchema.parse(
      await (await fixture.request(path)).json(),
    );
    expect(next.recordRevision).toBe(2);
    expect(next.contextHash).not.toBe(current.contextHash);
    expect((await fixture.request(`${path}?recordRevision=1`)).status).toBe(
      409,
    );
  });
  it('should match each explicit structured field against reviewed active topics and prefer topic evidence over a title', async ({
    fixture,
  }) => {
    const db = fixture.runtime.database.db;
    const { userId: ownerId } = await db.session.findFirstOrThrow();
    for (const field of ['category', 'material', 'period', 'name'] as const) {
      const topicId = randomUUID();
      const label = `Term ${topicId}`;
      const facet =
        field === 'name' || field === 'category' ? 'object_type' : field;
      await db.topic.create({
        data: { id: topicId, ownerId, contentId: `test:${topicId}`, facet },
      });
      await db.topicLabel.create({
        data: {
          id: randomUUID(),
          ownerId,
          topicId,
          language: 'en',
          text: label,
          normalizedText: label.toLowerCase(),
          kind: 'alias',
        },
      });
      const base = relatedContent(`Reference ${randomUUID()}`, [topicId]);
      const content = {
        ...base,
        editorialReview: {
          state: 'reviewed' as const,
          actor: ownerId,
          at: '2026-10-19T00:00:00.000Z',
        },
      };
      const matched = await createRelatedEntry(fixture, content);
      await createRelatedEntry(fixture, base);
      const selectedInput = knowledgeInput();
      const selectedResponse = await fixture.request('/v1/knowledge', 'POST', {
        ...selectedInput,
        status: 'saved',
        methodWrites: [],
        content: {
          ...selectedInput.content,
          titleZhHant: label,
          aliases: [],
          kinds: [facet],
        },
      });
      expect(selectedResponse.status).toBe(201);
      const selected = knowledgeDetailSchema.parse(
        await selectedResponse.json(),
      );
      const fields = {
        category: { categoryIds: [selected.entry.id] },
        material: { materialIds: [selected.entry.id] },
        period: { period: { label, status: 'collectorClaim' as const } },
        name: { name: label.toUpperCase() },
      };
      const record = await createRelatedRecord(fixture, fields[field]);
      const response = await fixture.request(
        `/v1/records/${record.id}/related-knowledge?locale=en`,
      );
      expect(response.status).toBe(200);
      const page = relatedKnowledgePageSchema.parse(await response.json());
      expect(page.cards).toMatchObject([
        {
          entryId: matched,
          matches: [expect.objectContaining({ field, topicId, label })],
        },
      ]);
      if (field === 'category' || field === 'material') {
        const linkedSelection = await createRelatedEntry(fixture, {
          ...relatedContent(`Selected ${randomUUID()}`, [topicId]),
          editorialReview: content.editorialReview,
        });
        const linkedFields = {
          category: { categoryIds: [linkedSelection] },
          material: { materialIds: [linkedSelection] },
        }[field];
        const linkedRecord = await createRelatedRecord(fixture, linkedFields);
        expect(
          await (
            await fixture.request(
              `/v1/records/${linkedRecord.id}/related-knowledge`,
            )
          ).json(),
        ).toMatchObject({
          cards: expect.arrayContaining([
            expect.objectContaining({ entryId: matched }),
          ]),
        });
        const pendingSelection = await createRelatedEntry(
          fixture,
          relatedContent(`Pending ${randomUUID()}`, [topicId]),
        );
        const pendingFields = {
          category: { categoryIds: [pendingSelection] },
          material: { materialIds: [pendingSelection] },
        }[field];
        const pendingRecord = await createRelatedRecord(fixture, pendingFields);
        expect(
          await (
            await fixture.request(
              `/v1/records/${pendingRecord.id}/related-knowledge`,
            )
          ).json(),
        ).toMatchObject({ cards: [], reason: 'no_match' });
        const draftSelection = await createRelatedEntry(
          fixture,
          relatedContent(label, [topicId]),
          'draft',
        );
        const draftFields = {
          category: { categoryIds: [draftSelection] },
          material: { materialIds: [draftSelection] },
        }[field];
        const draftRecord = await createRelatedRecord(fixture, draftFields);
        expect(
          await (
            await fixture.request(
              `/v1/records/${draftRecord.id}/related-knowledge`,
            )
          ).json(),
        ).toMatchObject({ cards: [], reason: 'no_match' });
      }
      const unknown = await createRelatedRecord(fixture, {
        categoryIds: [randomUUID()],
        materialIds: [randomUUID()],
      });
      expect(
        await (
          await fixture.request(`/v1/records/${unknown.id}/related-knowledge`)
        ).json(),
      ).toMatchObject({ cards: [], reason: 'no_match' });
      if (field === 'category') {
        expect(page.cards[0]!.category).toEqual([{ topicId, label }]);
        const wrongFacet = await createRelatedRecord(fixture, {
          materialIds: [selected.entry.id],
        });
        expect(
          await (
            await fixture.request(
              `/v1/records/${wrongFacet.id}/related-knowledge`,
            )
          ).json(),
        ).toMatchObject({ cards: [], reason: 'no_match' });
      }
      if (field === 'name') {
        await createRelatedEntry(fixture, relatedContent(label));
        const ranked = relatedKnowledgePageSchema.parse(
          await (
            await fixture.request(
              `/v1/records/${record.id}/related-knowledge?limit=1`,
            )
          ).json(),
        );
        expect(ranked.cards[0]!.entryId).toBe(matched);
      }
      await db.topic.update({
        where: { id: topicId },
        data: { retiredAt: new Date() },
      });
      const retired = relatedKnowledgePageSchema.parse(
        await (
          await fixture.request(`/v1/records/${record.id}/related-knowledge`)
        ).json(),
      );
      expect(retired.cards.map((card) => card.entryId)).not.toContain(matched);
    }
  });

  it('should exclude unconfirmed period, description, tags and collector judgment from record matching', async ({
    fixture,
  }) => {
    const title = `Inferred ${randomUUID()}`;
    await createRelatedEntry(fixture, relatedContent(title));
    const record = await createRelatedRecord(fixture, {
      description: title,
      tags: [title],
      collectorJudgment: title,
      period: { label: title, status: 'unconfirmed' },
    });
    const db = fixture.runtime.database.db;
    const { userId: ownerId } = await db.session.findFirstOrThrow();
    const jobId = randomUUID();
    await db.jobs.create({
      data: {
        id: jobId,
        ownerId,
        kind: 'record_edit',
        resourceId: record.id,
        state: 'completed',
        stage: 'completed',
      },
    });
    await db.editDraftRuns.create({
      data: {
        id: randomUUID(),
        ownerId,
        jobId,
        recordId: record.id,
        revision: 1,
        status: 'ready',
        snapshot: record,
        request: { instructionZhHant: title },
        modelSelection: {},
        result: {
          proposedChanges: [
            {
              id: randomUUID(),
              field: 'name',
              before: null,
              proposed: title,
              findingIds: [],
            },
          ],
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    const response = await fixture.request(
      `/v1/records/${record.id}/related-knowledge`,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      cards: [],
      reason: 'no_match',
    });
  });

  it('should return reviewed supported translated excerpts and withhold pending claims', async ({
    fixture,
  }) => {
    const db = fixture.runtime.database.db;
    const { userId } = await db.session.findFirstOrThrow();
    const cited = await citedEnvelope(db, userId);
    const title = `Evidence ${randomUUID()}`;
    const content = {
      ...cited,
      titles: [
        { language: 'en', text: title },
        { language: 'zh-Hant', text: '已審核資料' },
      ],
    };
    const saved = await createRelatedEntry(fixture, content);
    const pending = await createRelatedEntry(fixture, {
      ...content,
      claims: content.claims.map((claim) => ({
        ...claim,
        review: { state: 'pending' as const },
      })),
    });
    const record = await createRelatedRecord(fixture, { name: title });
    for (const locale of ['en', 'zh-Hant']) {
      const response = await fixture.request(
        `/v1/records/${record.id}/related-knowledge?locale=${locale}`,
      );
      expect(response.status).toBe(200);
      const page = relatedKnowledgePageSchema.parse(await response.json());
      expect(page.cards.find((card) => card.entryId === saved)).toMatchObject({
        title: locale === 'en' ? title : '已審核資料',
        language: locale,
        fallback: false,
        excerpt: {
          text:
            locale === 'en'
              ? 'Reviewed porcelain observation'
              : '已審核瓷器觀察',
          language: locale,
          citations: cited.citations,
        },
      });
      expect(page.cards.find((card) => card.entryId === pending)).toMatchObject(
        { excerpt: null },
      );
    }
  });

  it('should hide foreign and missing records and isolate foreign knowledge', async ({
    fixture,
  }) => {
    const title = `Private ${randomUUID()}`;
    const record = await createRelatedRecord(fixture, { name: title });
    const db = fixture.runtime.database.db;
    const { userId: ownerId } = await db.session.findFirstOrThrow();
    const foreign = randomUUID();
    const { transaction, clock, ids } = fixture.runtime;
    const entry = await createKnowledgeService(
      transaction,
      clock,
      ids,
    ).createV2(foreign, {
      requestKey: randomUUID(),
      expectedRevision: null,
      content: relatedContent(title),
      status: 'saved',
      reviewDecisions: [],
      translationDecisions: [],
    });
    expect(entry.success).toBe(true);
    try {
      expect(
        await (
          await fixture.request(`/v1/records/${record.id}/related-knowledge`)
        ).json(),
      ).toMatchObject({ cards: [], reason: 'no_match' });
      await db.records.update({
        where: { id: record.id },
        data: { ownerId: foreign },
      });
      expect(
        (await fixture.request(`/v1/records/${record.id}/related-knowledge`))
          .status,
      ).toBe(404);
      expect(
        (await fixture.request(`/v1/records/${randomUUID()}/related-knowledge`))
          .status,
      ).toBe(404);
      expect(
        (
          await fixture.runtime.app.request(
            `http://127.0.0.1:8080/v1/records/${record.id}/related-knowledge`,
          )
        ).status,
      ).toBe(401);
    } finally {
      await db.records.update({ where: { id: record.id }, data: { ownerId } });
    }
  });

  it('should keep a database discovery failure local to the knowledge section', async ({
    fixture,
  }) => {
    const record = await createRelatedRecord(fixture, {
      name: `Local ${randomUUID()}`,
    });
    const db = fixture.runtime.database.db;
    await db.$executeRawUnsafe(
      'ALTER TABLE knowledge_search_documents RENAME TO unavailable_knowledge_search_documents',
    );
    try {
      const response = await fixture.request(
        `/v1/records/${record.id}/related-knowledge`,
      );
      expect(response.status).toBeGreaterThanOrEqual(500);
      expect(
        await (await fixture.request(`/v1/records/${record.id}`)).json(),
      ).toEqual(record);
    } finally {
      await db.$executeRawUnsafe(
        'ALTER TABLE unavailable_knowledge_search_documents RENAME TO knowledge_search_documents',
      );
    }
    expect(
      (await fixture.request(`/v1/records/${record.id}/related-knowledge`))
        .status,
    ).toBe(200);
  });
});
