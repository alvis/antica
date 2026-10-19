import { createHash, randomUUID } from 'node:crypto';

import { PrismaPg } from '@prisma/adapter-pg';

import { describe, expect, inject } from 'vitest';

import { PrismaClient } from '../../generated/client.js';
import { createDatabaseTest } from '../../spec/fixtures/runner.js';

import { createKnowledgeRepository } from '../knowledge.js';

import { runKnowledgeSearchBackfill } from './search-backfill.js';
import { backfillKnowledgeSearch } from './search-projection.js';
import {
  createKnowledgeDiscovery,
  createKnowledgeSearchRepository,
} from './search.js';

import type { KnowledgeContentEnvelopeV2 } from '@antica/contracts';

import type { Transaction } from '../../transaction.js';

const resources = inject('platformDatabases');
const it = createDatabaseTest(resources['knowledge-search']!).extend<{
  $file: { capability: void };
}>({
  capability: [
    async ({ connection }, use) => {
      if (process.env.ANTICA_KNOWLEDGE_SEARCH_MODE === 'degraded') {
        await connection.db.$executeRawUnsafe(
          'DROP EXTENSION IF EXISTS pg_trgm CASCADE',
        );
        await connection.db.$executeRawUnsafe(
          'DROP EXTENSION IF EXISTS unaccent CASCADE',
        );
        expect(
          await connection.db
            .$queryRaw`SELECT extname FROM pg_extension WHERE extname IN ('pg_trgm','unaccent')`,
        ).toEqual([]);
      }
      await use();
    },
    { scope: 'file', auto: true },
  ],
});
const input = { locale: 'zh-Hant' as const, view: 'saved' as const, limit: 50 };

describe('fn:createKnowledgeSearchRepository', { timeout: 30_000 }, () => {
  it('should find Traditional Chinese words, aliases, short marks and English without converting scripts', async ({
    connection,
  }) => {
    const ownerId = randomUUID();
    const id = await createEntry(connection.db, ownerId, envelope('青花瓷碗'));
    const repository = createKnowledgeSearchRepository(connection.db, ownerId);
    for (const q of ['青花', '康熙', '康', 'blue and white', 'CAFÉ']) {
      expect(await repository.search({ ...input, q })).toMatchObject({
        success: true,
        data: {
          hits: [expect.objectContaining({ id, revision: 1 })],
          total: 1,
        },
      });
    }
    expect(await repository.search({ ...input, q: '青花瓷碗' })).toMatchObject({
      success: true,
      data: { hits: [expect.objectContaining({ id })] },
    });
    const red = await createEntry(connection.db, ownerId, envelope('釉裡紅'));
    expect(await repository.search({ ...input, q: '釉裡紅' })).toMatchObject({
      success: true,
      data: { hits: [expect.objectContaining({ id: red })] },
    });
    expect(await repository.search({ ...input, q: '釉里红' })).toMatchObject({
      success: true,
      data: { total: 0, hits: [] },
    });
  });

  it('should pin saved and working heads, isolate owners and withhold unreviewed excerpts', async ({
    connection,
  }) => {
    const ownerId = randomUUID();
    const id = await createEntry(
      connection.db,
      ownerId,
      envelope('Saved porcelain'),
    );
    const draftId = await createEntry(connection.db, ownerId, {
      ...envelope('Draft porcelain'),
      status: 'draft',
    });
    await createKnowledgeRepository(connection.db, ownerId).addRevisionV2({
      entryId: id,
      expectedRevision: 1,
      content: envelope('Working porcelain'),
      status: 'draft',
      savedBy: null,
      reviewedBy: null,
      reviewedAt: null,
    });
    const repository = createKnowledgeSearchRepository(connection.db, ownerId);
    expect(await repository.search(input)).toMatchObject({
      success: true,
      data: {
        total: 1,
        hits: [expect.objectContaining({ id, revision: 1, excerpt: null })],
      },
    });
    const working = await repository.search({ ...input, view: 'working' });
    expect(working).toMatchObject({
      success: true,
      data: {
        total: 2,
        hits: expect.arrayContaining([
          expect.objectContaining({ id, revision: 2 }),
          expect.objectContaining({ id: draftId, revision: 1 }),
        ]),
      },
    });
    expect(
      await createKnowledgeSearchRepository(connection.db, randomUUID()).search(
        { ...input, view: 'working' },
      ),
    ).toMatchObject({ success: true, data: { total: 0, hits: [] } });
  });

  it('should return reviewed located support with citations while rejecting stale translated excerpts', async ({
    connection,
  }) => {
    const ownerId = randomUUID();
    const content = await citedEnvelope(connection.db, ownerId);
    const id = await createEntry(connection.db, ownerId, content);
    const repository = createKnowledgeSearchRepository(connection.db, ownerId);
    expect(await repository.search({ ...input, locale: 'en' })).toMatchObject({
      success: true,
      data: {
        hits: [
          expect.objectContaining({
            id,
            excerpt: {
              claimKey: 'body',
              text: 'Reviewed porcelain observation',
              language: 'en',
              citations: content.citations,
            },
          }),
        ],
      },
    });
    expect(await repository.search(input)).toMatchObject({
      success: true,
      data: {
        hits: [
          expect.objectContaining({
            id,
            excerpt: expect.objectContaining({
              text: '已審核瓷器觀察',
              language: 'zh-Hant',
            }),
          }),
        ],
      },
    });
    const stale = {
      ...content,
      claims: content.claims.map((claim) => ({
        ...claim,
        variants: claim.variants.map((variant) => ({
          ...variant,
          sourceTextHash: 'f'.repeat(64),
        })),
      })),
    };
    await expect(
      connection.db.$transaction(async (tx) =>
        createKnowledgeRepository(tx, ownerId).addRevisionV2({
          entryId: id,
          expectedRevision: 1,
          content: stale,
          status: 'saved',
          savedBy: 'collector',
          reviewedBy: ownerId,
          reviewedAt: new Date('2026-10-19T00:00:00.000Z'),
        }),
      ),
    ).rejects.toThrow('Language variant does not match its original claim');
    expect(await repository.search(input)).toMatchObject({
      success: true,
      data: {
        hits: [
          expect.objectContaining({
            id,
            revision: 1,
            excerpt: expect.objectContaining({
              text: '已審核瓷器觀察',
              language: 'zh-Hant',
            }),
          }),
        ],
      },
    });
  });

  it('should paginate equal-ranked matches stably and expire cursors after projection changes', async ({
    connection,
  }) => {
    const ownerId = randomUUID();
    const ids: string[] = [];
    for (let index = 0; index < 3; index += 1) {
      ids.push(
        await createEntry(connection.db, ownerId, envelope('Equal title')),
      );
    }
    const repository = createKnowledgeSearchRepository(connection.db, ownerId);
    const first = await repository.search({ ...input, limit: 1 });
    expect(first.success).toBe(true);
    if (!first.success) {
      throw new Error('Expected first search page');
    }
    expect(first.data.nextCursor).toEqual(expect.any(String));
    const next = { ...input, limit: 1, cursor: first.data.nextCursor! };
    const second = await repository.search(next);
    expect(second).toEqual(await repository.search(next));
    if (!second.success) {
      throw new Error('Expected second search page');
    }
    const third = await repository.search({
      ...next,
      cursor: second.data.nextCursor!,
    });
    if (!third.success) {
      throw new Error('Expected third search page');
    }
    expect(
      [...first.data.hits, ...second.data.hits, ...third.data.hits]
        .map((hit) => hit.id)
        .toSorted(),
    ).toEqual(ids.toSorted());
    expect(third.data.nextCursor).toBeNull();
    expect(await repository.search({ ...next, q: 'changed' })).toMatchObject({
      success: false,
      error: { code: 'VALIDATION_FAILED' },
    });
    expect(
      await createKnowledgeSearchRepository(connection.db, randomUUID()).search(
        next,
      ),
    ).toMatchObject({ success: false, error: { code: 'VALIDATION_FAILED' } });
    await createEntry(connection.db, ownerId, envelope('New generation'));
    expect(await repository.search(next)).toMatchObject({
      success: false,
      error: { code: 'SEARCH_CURSOR_EXPIRED' },
    });
    expect(
      await repository.search({ ...input, cursor: 'not-a-cursor' }),
    ).toMatchObject({ success: false, error: { code: 'VALIDATION_FAILED' } });
  });

  it('should OR topics in a facet, AND facets and expand descendants while self-excluding counts', async ({
    connection,
  }) => {
    const ownerId = randomUUID();
    const root = randomUUID();
    const child = randomUUID();
    const sibling = randomUUID();
    const material = randomUUID();
    await connection.db.topic.createMany({
      data: [
        { id: root, ownerId, contentId: `test:${root}`, facet: 'category' },
        {
          id: sibling,
          ownerId,
          contentId: `test:${sibling}`,
          facet: 'category',
        },
        {
          id: material,
          ownerId,
          contentId: `test:${material}`,
          facet: 'material',
        },
      ],
    });
    await connection.db.topic.create({
      data: {
        id: child,
        ownerId,
        contentId: `test:${child}`,
        facet: 'category',
        parentId: root,
      },
    });
    await connection.db.topicLabel.create({
      data: {
        id: randomUUID(),
        ownerId,
        topicId: material,
        language: 'zh-Hant',
        text: '瓷器',
        normalizedText: '瓷器',
        kind: 'preferred',
      },
    });
    const first = await createEntry(
      connection.db,
      ownerId,
      envelope('First', [child, material]),
    );
    const second = await createEntry(
      connection.db,
      ownerId,
      envelope('Second', [sibling, material]),
    );
    await createEntry(connection.db, ownerId, envelope('Third', [child]));
    const repository = createKnowledgeSearchRepository(connection.db, ownerId);
    expect(
      await repository.search({
        ...input,
        topics: { category: [root, sibling], material: [material] },
      }),
    ).toMatchObject({
      success: true,
      data: {
        total: 2,
        hits: expect.arrayContaining([
          expect.objectContaining({ id: first }),
          expect.objectContaining({ id: second }),
        ]),
      },
    });
    expect(
      await repository.search({
        ...input,
        topics: { category: [root], material: [material] },
      }),
    ).toMatchObject({
      success: true,
      data: {
        total: 1,
        hits: [expect.objectContaining({ id: first })],
        facets: expect.arrayContaining([
          expect.objectContaining({ facet: 'category', id: sibling, count: 1 }),
        ]),
      },
    });
    expect(
      await repository.search({ ...input, languages: ['fr'] }),
    ).toMatchObject({ success: true, data: { total: 0 } });
    expect(
      await repository.search({ ...input, providers: ['absent'] }),
    ).toMatchObject({ success: true, data: { total: 0 } });
    expect(
      await repository.search({ ...input, entryTypes: ['method'] }),
    ).toMatchObject({ success: true, data: { total: 0 } });
  });

  it('should keep search page, total and facets within one business SQL statement', async ({
    connection,
  }) => {
    const ownerId = randomUUID();
    const id = await createEntry(connection.db, ownerId, envelope('青花'));
    const db = new PrismaClient({
      adapter: new PrismaPg({ connectionString: connection.url, max: 1 }),
      log: [{ emit: 'event', level: 'query' }],
    });
    const queries: string[] = [];
    db.$on('query', (event) => queries.push(event.query));
    try {
      expect(
        await createKnowledgeSearchRepository(db, ownerId).search(input),
      ).toMatchObject({
        success: true,
        data: { total: 1, hits: [expect.objectContaining({ id })] },
      });
      expect(queries.length).toBeLessThanOrEqual(1);
      expect(queries.length).toBeGreaterThan(0);
      const discovery = createKnowledgeDiscovery(db);
      const beforeTopics = queries.length;
      expect(
        await discovery.topics(ownerId, { locale: 'en', limit: 20 }),
      ).toMatchObject({ success: true, data: { items: [] } });
      expect(queries.length - beforeTopics).toBeLessThanOrEqual(1);
      const beforeDetail = queries.length;
      expect(
        await discovery.detail(ownerId, id, { view: 'saved' }),
      ).toMatchObject({
        detail: { id, revision: 1, content: envelope('青花') },
      });
      expect(queries.length - beforeDetail).toBeLessThanOrEqual(2);
      expect(
        await discovery.detail(ownerId, id, { view: 'working' }),
      ).toMatchObject({ detail: { id, revision: 1 } });
      expect(
        await discovery.detail(ownerId, id, { view: 'revision', revision: 1 }),
      ).toMatchObject({ detail: { id, revision: 1 } });
      expect(await discovery.detail(ownerId, id, {})).toMatchObject({
        detail: { id, revision: 1 },
      });
      expect(
        await discovery.detail(randomUUID(), id, { view: 'saved' }),
      ).toBeNull();
      expect(await discovery.search(ownerId, input)).toMatchObject({
        success: true,
        data: { total: 1 },
      });
      expect(
        await discovery.tree(ownerId, randomUUID(), {
          locale: 'en',
          depth: 1,
          childrenLimit: 1,
        }),
      ).toMatchObject({ success: false, error: { code: 'NOT_FOUND' } });
    } finally {
      await db.$disconnect();
    }
  });
});

describe('knowledge topic browsing', () => {
  it('should localize roots and paginate bounded children while preserving owner scope', async ({
    connection,
  }) => {
    const ownerId = randomUUID();
    const root = randomUUID();
    const child = randomUUID();
    const sibling = randomUUID();
    const grandchild = randomUUID();
    await connection.db.topic.create({
      data: { id: root, ownerId, contentId: `test:${root}`, facet: 'category' },
    });
    await connection.db.topic.createMany({
      data: [
        {
          id: child,
          ownerId,
          contentId: `test:${child}`,
          facet: 'category',
          parentId: root,
          sortOrder: 1,
        },
        {
          id: sibling,
          ownerId,
          contentId: `test:${sibling}`,
          facet: 'category',
          parentId: root,
          sortOrder: 2,
        },
      ],
    });
    await connection.db.topic.create({
      data: {
        id: grandchild,
        ownerId,
        contentId: `test:${grandchild}`,
        facet: 'category',
        parentId: child,
      },
    });
    await connection.db.topicLabel.createMany({
      data: [
        {
          id: randomUUID(),
          ownerId,
          topicId: root,
          language: 'zh-Hant',
          text: '陶瓷',
          normalizedText: '陶瓷',
          kind: 'preferred',
        },
        {
          id: randomUUID(),
          ownerId,
          topicId: root,
          language: 'en',
          text: 'Ceramics',
          normalizedText: 'ceramics',
          kind: 'preferred',
        },
      ],
    });
    const repository = createKnowledgeSearchRepository(connection.db, ownerId);
    expect(await repository.topics({ locale: 'en', limit: 1 })).toMatchObject({
      success: true,
      data: {
        items: [
          expect.objectContaining({
            id: root,
            label: 'Ceramics',
            childCount: 2,
          }),
        ],
        total: 1,
        nextCursor: null,
      },
    });
    expect(
      await repository.topics({
        locale: 'en',
        limit: 20,
        facet: 'category',
        q: 'Ceramics',
      }),
    ).toMatchObject({
      success: true,
      data: { items: [expect.objectContaining({ id: root })], total: 1 },
    });
    expect(
      await repository.topics({ locale: 'en', limit: 20, q: 'absent%_' }),
    ).toMatchObject({ success: true, data: { items: [], total: 0 } });
    const browse = await repository.topics({
      locale: 'en',
      parentId: root,
      limit: 1,
    });
    if (!browse.success) {
      throw new Error('Expected topic page');
    }
    expect(browse.data.items).toMatchObject([{ id: child }]);
    expect(
      await repository.topics({
        locale: 'en',
        parentId: root,
        limit: 1,
        cursor: browse.data.nextCursor!,
      }),
    ).toMatchObject({
      success: true,
      data: {
        items: [expect.objectContaining({ id: sibling })],
        nextCursor: null,
      },
    });
    const treeInput = { locale: 'en' as const, depth: 2, childrenLimit: 1 };
    const tree = await repository.tree(root, treeInput);
    if (!tree.success) {
      throw new Error('Expected topic tree');
    }
    expect(tree.data.descendants).toMatchObject([
      { id: child, depth: 1 },
      { id: grandchild, depth: 2 },
    ]);
    expect(
      await repository.tree(root, {
        ...treeInput,
        cursor: tree.data.nextCursor!,
      }),
    ).toMatchObject({
      success: true,
      data: {
        descendants: [expect.objectContaining({ id: sibling })],
        nextCursor: null,
      },
    });
    expect(await repository.tree(grandchild, treeInput)).toMatchObject({
      success: true,
      data: {
        ancestors: [
          expect.objectContaining({ id: root }),
          expect.objectContaining({ id: child }),
        ],
      },
    });
    expect(
      await createKnowledgeSearchRepository(connection.db, randomUUID()).tree(
        root,
        treeInput,
      ),
    ).toMatchObject({ success: false, error: { code: 'NOT_FOUND' } });
    expect(
      await repository.topics({ locale: 'en', limit: 1, cursor: 'invalid' }),
    ).toMatchObject({ success: false });
    expect(
      await repository.tree(root, { ...treeInput, cursor: 'invalid' }),
    ).toMatchObject({ success: false });
  });
});

describe('fn:backfillKnowledgeSearch', () => {
  it('should recreate missing projections and leave a second backfill unchanged', async ({
    connection,
  }) => {
    const ownerId = randomUUID();
    const id = await createEntry(
      connection.db,
      ownerId,
      envelope('Backfilled porcelain'),
    );
    await connection.db.knowledgeSearchDocument.deleteMany({
      where: { ownerId },
    });
    expect(
      await runKnowledgeSearchBackfill(['--owner-id', ownerId], connection.url),
    ).toBe(1);
    const first = await connection.db.knowledgeSearchDocument.findMany({
      where: { ownerId },
      orderBy: [{ entryId: 'asc' }, { revision: 'asc' }, { language: 'asc' }],
    });
    expect(first.length).toBeGreaterThan(0);
    await backfillKnowledgeSearch(connection.db, ownerId);
    expect(
      await connection.db.knowledgeSearchDocument.findMany({
        where: { ownerId },
        orderBy: [{ entryId: 'asc' }, { revision: 'asc' }, { language: 'asc' }],
      }),
    ).toEqual(first);
    expect(
      await createKnowledgeSearchRepository(connection.db, ownerId).search(
        input,
      ),
    ).toMatchObject({
      success: true,
      data: { hits: [expect.objectContaining({ id })] },
    });
  });
});

/**
 * creates a real revision through the production writer for varied search fixtures
 * @param tx production database client
 * @param ownerId isolated collector identity
 * @param content revision envelope and optional draft state
 */
async function createEntry(
  tx: Transaction,
  ownerId: string,
  content: KnowledgeContentEnvelopeV2 & { status?: 'saved' | 'draft' },
): Promise<string> {
  const entryId = randomUUID();
  const { status = 'saved', ...envelopeContent } = content;
  await createKnowledgeRepository(tx, ownerId).createV2({
    entryId,
    displayCode: `KN-${entryId}`,
    content: envelopeContent,
    status,
    savedBy: status === 'saved' ? 'collector' : null,
    reviewedBy: null,
    reviewedAt: null,
  });

  return entryId;
}

/**
 * varies title and topic membership while retaining unsupported discovery text
 * @param title original title for lexical matching
 * @param topicIds taxonomy memberships
 */
function envelope(
  title: string,
  topicIds: string[] = [],
): KnowledgeContentEnvelopeV2 {
  return {
    contentSchemaVersion: 2,
    entryType: 'concept',
    origin: 'collector',
    titles: [{ language: 'zh-Hant', text: title }],
    aliases: [
      { language: 'en', text: 'blue and white café' },
      { language: 'zh-Hant', text: '康熙' },
    ],
    sections: {
      summary: {
        claimKey: 'body',
        text: 'Unreviewed observation',
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
        originalText: 'Unreviewed observation',
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
    topics: topicIds.map((topicId) => ({ topicId, applicability: 'general' })),
    citations: [],
    images: [],
    methodIds: [],
    relatedEntryIds: [],
    editorialReview: { state: 'pending' },
  };
}

/**
 * preserves one located web source and a reviewed bilingual claim
 * @param tx production connection
 * @param ownerId collector owning the evidence
 * @returns canonical envelope with immutable support metadata
 */
async function citedEnvelope(
  tx: Transaction,
  ownerId: string,
): Promise<KnowledgeContentEnvelopeV2> {
  const sourceId = randomUUID();
  const versionId = randomUUID();
  const citationId = randomUUID();
  const instant = '2026-10-19T00:00:00.000Z';
  const originalText = 'Reviewed porcelain observation';
  const source = {
    id: sourceId,
    versionId,
    title: 'Catalog',
    canonicalUrl: 'https://museum.example/1',
    languages: ['en'],
    contributors: [],
  };
  await tx.sources.create({
    data: {
      id: sourceId,
      ownerId,
      kind: 'web',
      title: source.title,
      authorStatus: 'unknown',
      access: 'link_only',
    },
  });
  await tx.sourceVersions.create({
    data: {
      id: versionId,
      sourceId,
      ownerId,
      sourceHash: 'a'.repeat(64),
      metadataSnapshot: {
        title: source.title,
        canonicalUrl: source.canonicalUrl,
        languages: source.languages,
        contributors: [],
      },
      capturedAt: instant,
      status: 'registered',
      textIndexStatus: 'registered',
      imageIndexStatus: 'registered',
    },
  });
  await tx.sourceLocators.create({
    data: {
      id: citationId,
      sourceId,
      sourceVersionId: versionId,
      kind: 'web',
      url: source.canonicalUrl,
      retrievedAt: instant,
      excerptAsRetrieved: originalText,
    },
  });
  await tx.citations.create({
    data: {
      id: citationId,
      locatorId: citationId,
      relation: 'supports',
      availability: 'link_only',
      verification: 'located',
    },
  });
  const citation: KnowledgeContentEnvelopeV2['citations'][number] = {
    id: citationId,
    relation: 'supports',
    availability: 'link_only',
    verification: 'located',
    quote: originalText,
    locator: {
      kind: 'web',
      id: citationId,
      sourceId,
      sourceVersionId: versionId,
      url: source.canonicalUrl,
      retrievedAt: instant,
      excerpt: originalText,
    },
    source,
  };
  const base = envelope('Reviewed porcelain');
  const review = { state: 'reviewed' as const, actor: ownerId, at: instant };

  return {
    ...base,
    sections: {
      ...base.sections,
      summary: {
        claimKey: 'body',
        text: originalText,
        citationIds: [citationId],
        supportState: 'cited',
      },
    },
    claims: [
      {
        ...base.claims[0]!,
        originalText,
        supportState: 'cited',
        citationIds: [citationId],
        review,
        variants: [
          {
            language: 'zh-Hant',
            kind: 'translation',
            text: '已審核瓷器觀察',
            method: 'human',
            sourceTextHash: createHash('sha256')
              .update(originalText)
              .digest('hex'),
            review,
          },
        ],
      },
    ],
    citations: [citation],
    editorialReview: review,
  };
}
