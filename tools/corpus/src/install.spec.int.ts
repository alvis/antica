import { randomUUID } from 'node:crypto';
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test, vi } from 'vitest';

import { corpusFileSchema } from '@antica/contracts';

import { installCorpusRelease } from '../../../packages/application/src/knowledge/corpus-install.js';
import { createDatabase } from '../../../packages/platform/src/database/connection.js';

import { createCorpusContent } from '../../../packages/platform/src/database/repositories/corpus-content.js';
import { corpusId } from '../../../packages/platform/src/database/repositories/corpus-identity.js';
import { createCorpusInstallRepository } from '../../../packages/platform/src/database/repositories/corpus-install.js';
import { preloadCorpusReferences } from '../../../packages/platform/src/database/repositories/corpus-references.js';
import { createKnowledgeV2Repository } from '../../../packages/platform/src/database/repositories/knowledge/v2.js';

import { canonicalJson, sha256 } from './canonical.js';
import { createCorpusFixture } from './fixtures/corpus.js';
import {
  createGuideCorpusFixture,
  createGuideFixture,
  writeGuideCorpusFixture,
} from './fixtures/guides.js';
import {
  loadCorpusInstallRequest,
  runCorpusInstallCommand,
} from './install.js';

import type { CorpusInstallRequest } from '../../../packages/application/src/knowledge/corpus-install.js';
import type {
  DatabaseConnection,
  Database,
} from '../../../packages/platform/src/database/connection.js';

const databaseUrl = process.env.ANTICA_TEST_DATABASE_URL;
if (
  !databaseUrl ||
  !/(?:^|_)tests?(?:_|$)/.test(new URL(databaseUrl).pathname.slice(1))
) {
  throw new Error(
    'ANTICA_TEST_DATABASE_URL must name a throwaway test database',
  );
}
const it = test.extend<{ connection: DatabaseConnection }>({
  connection: async ({ task: _task }, use) => {
    const connection = createDatabase({ url: databaseUrl, maxConnections: 2 });
    try {
      await use(connection);
    } finally {
      await connection.close();
    }
  },
});

describe('fn:installCorpusRelease', { timeout: 120_000 }, () => {
  it('should install and retry a source-page-only guide image without inventing evidence or uploaded assets', async ({
    connection,
  }) => {
    const fixture = createGuideFixture();
    fixture.source.locators = [];
    fixture.source.citations = [];
    delete fixture.source.images[0]!.locatorId;
    const check = fixture.guide.checks[0]!;
    check.statements = check.statements.map((statement) => ({
      ...statement,
      supportState: 'needs_source',
      citationIds: [],
    }));
    check.gap = {
      fields: ['what', 'why', 'howToSee', 'typical', 'warningSigns'],
      need: 'Locate supporting text; the captured photograph alone is not a citation.',
    };
    const directory = writeGuideCorpusFixture(
      createGuideCorpusFixture(fixture),
    );
    try {
      const loaded = loadCorpusInstallRequest([
        '--owner-id',
        randomUUID(),
        '--request-key',
        randomUUID(),
        '--dir',
        directory,
        '--release',
        '1.1.0',
      ]);
      const request = {
        ...loaded,
        release: { ...loaded.release, corpusId: `antica:test:${randomUUID()}` },
      };

      const plan = await installCorpusRelease(
        request,
        createCorpusInstallRepository(connection.db),
      );
      const content = createCorpusContent(request.ownerId, request.sources);
      const sourceId = content.sourceId(fixture.source);
      const sourceVersionId = content.versionId(fixture.source);
      const image = await connection.db.referenceImages.findUniqueOrThrow({
        where: {
          id: content.childId(fixture.source, fixture.source.images[0]!.id),
        },
      });
      expect(image).toMatchObject({
        sourceVersionId,
        externalImageUrl: fixture.source.images[0]!.remoteUrl,
        sourcePageUrl: fixture.source.sourcePageUrl,
        figureRegionId: null,
        storedDerivativeId: null,
      });
      expect(
        await connection.db.sources.findUniqueOrThrow({
          where: { id: sourceId },
        }),
      ).toMatchObject({
        canonicalUrl: fixture.source.sourcePageUrl,
      });
      expect(content.snapshot(fixture.source)).toMatchObject({
        sourcePageUrl: fixture.source.sourcePageUrl,
        retrievedAt: fixture.source.retrievedAt,
      });
      expect(
        await connection.db.sourceLocators.findMany({
          where: { sourceVersionId },
        }),
      ).toEqual([
        expect.objectContaining({
          id: image.locatorId,
          sourceId,
          sourceVersionId,
          kind: 'web',
          url: fixture.source.sourcePageUrl,
          retrievedAt: new Date(fixture.source.retrievedAt),
          pageId: null,
          pageIndex: null,
          printedPageLabel: null,
          canonicalViewId: null,
        }),
      ]);
      expect(
        await connection.db.citations.count({
          where: { sourceLocators: { sourceId } },
        }),
      ).toBe(0);
      expect(
        await connection.db.sourcePages.count({ where: { sourceVersionId } }),
      ).toBe(0);
      expect(
        await connection.db.mediaAssets.count({
          where: { ownerId: request.ownerId },
        }),
      ).toBe(0);
      expect(plan.items.map((item) => item.contentId).sort()).toEqual(
        request.entries.map((entry) => entry.id).sort(),
      );
      expect(
        await connection.db.knowledgeEntries.count({
          where: { ownerId: request.ownerId },
        }),
      ).toBe(request.entries.length);
      expect(
        await connection.db.knowledgeEntries.findUnique({
          where: { id: corpusId(request.ownerId, fixture.guide.id) },
        }),
      ).toBeNull();
      const beforeRetry = await countRows(connection.db, request.ownerId);

      const repeated = await installCorpusRelease(
        request,
        createCorpusInstallRepository(connection.db),
      );

      expect(repeated).toMatchObject({
        installId: plan.installId,
        completed: true,
      });
      expect(await countRows(connection.db, request.ownerId)).toEqual(
        beforeRetry,
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('should install synthetic guide page evidence without creating a guide draft or uploaded page', async ({
    connection,
  }) => {
    const fixture = createGuideFixture();
    fixture.source.locators = [
      {
        kind: 'page',
        id: fixture.source.locators[0]!.id,
        pageId: 'antica:page:printed-xvii',
        printedPageLabel: 'xvii',
        excerpt: fixture.source.citations[0]!.quote,
      },
    ];
    const directory = writeGuideCorpusFixture(
      createGuideCorpusFixture(fixture),
    );
    try {
      const args = [
        '--owner-id',
        randomUUID(),
        '--request-key',
        randomUUID(),
        '--dir',
        directory,
      ];
      const legacy = loadCorpusInstallRequest([...args, '--release', '1.0.0']);
      const current = loadCorpusInstallRequest([...args, '--release', '1.1.0']);
      const corpusIdentity = `antica:test:${randomUUID()}`;
      const legacyRequest = {
        ...legacy,
        release: { ...legacy.release, corpusId: corpusIdentity },
      };
      const currentRequest = {
        ...current,
        requestKey: randomUUID(),
        release: { ...current.release, corpusId: corpusIdentity },
      };
      const content = createCorpusContent(current.ownerId, current.sources);
      const sourceId = content.sourceId(fixture.source);

      await installCorpusRelease(
        legacyRequest,
        createCorpusInstallRepository(connection.db),
      );
      expect(
        await connection.db.sources.findUnique({ where: { id: sourceId } }),
      ).toBeNull();
      const plan = await installCorpusRelease(
        currentRequest,
        createCorpusInstallRepository(connection.db),
      );
      expect(plan.items.map((item) => item.contentId).sort()).toEqual(
        current.entries.map((entry) => entry.id).sort(),
      );
      expect(
        await connection.db.knowledgeEntries.count({
          where: { ownerId: current.ownerId },
        }),
      ).toBe(current.entries.length);
      expect(
        await connection.db.knowledgeEntries.findUnique({
          where: { id: corpusId(current.ownerId, fixture.guide.id) },
        }),
      ).toBeNull();
      expect(
        await connection.db.sourceLocators.findUniqueOrThrow({
          where: {
            id: content.childId(fixture.source, fixture.source.locators[0]!.id),
          },
        }),
      ).toMatchObject({
        kind: 'web',
        sourceId,
        url: fixture.source.sourcePageUrl,
        printedPageLabel: 'xvii',
        pageIndex: null,
        pageId: null,
        excerptAsRetrieved: fixture.source.citations[0]!.quote,
      });
      expect(
        await connection.db.sourcePages.count({
          where: { sourceVersionId: content.versionId(fixture.source) },
        }),
      ).toBe(0);
      expect(
        await connection.db.citations.findUniqueOrThrow({
          where: {
            id: content.childId(
              fixture.source,
              fixture.source.citations[0]!.id,
            ),
          },
        }),
      ).toMatchObject({
        locatorId: content.childId(
          fixture.source,
          fixture.source.locators[0]!.id,
        ),
        availability: 'link_only',
        verification: 'located',
        relation: 'supports',
      });
      const beforeRetry = await countRows(connection.db, current.ownerId);
      await installCorpusRelease(
        currentRequest,
        createCorpusInstallRepository(connection.db),
      );
      expect(await countRows(connection.db, current.ownerId)).toEqual(
        beforeRetry,
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('should install the real corpus exclusively as owner drafts and retry without adding rows', async ({
    connection,
  }) => {
    const request = loadCorpusInstallRequest([
      '--owner-id',
      randomUUID(),
      '--release',
      '1.0.1',
      '--request-key',
      randomUUID(),
    ]);
    const plan = await installCorpusRelease(
      request,
      createCorpusInstallRepository(connection.db),
    );
    expect(plan.items).toHaveLength(56);
    expect(plan.items.every((item) => item.disposition === 'created')).toBe(
      true,
    );
    const entries = await connection.db.knowledgeEntries.findMany({
      where: { ownerId: request.ownerId },
      include: { knowledgeRevisions: true },
    });
    expect(entries).toHaveLength(56);
    expect(
      entries.every(
        (entry) =>
          entry.latestSavedRevision === null &&
          entry.currentRevision === 1 &&
          entry.knowledgeRevisions.length === 1 &&
          entry.knowledgeRevisions[0]?.status === 'draft' &&
          entry.knowledgeRevisions[0].savedBy === null &&
          entry.knowledgeRevisions[0].contentSchemaVersion === 2,
      ),
    ).toBe(true);
    const before = await countRows(connection.db, request.ownerId);
    const repeated = await installCorpusRelease(
      request,
      createCorpusInstallRepository(connection.db),
    );
    expect(repeated).toMatchObject({
      installId: plan.installId,
      completed: true,
    });
    expect(await countRows(connection.db, request.ownerId)).toEqual(before);
    const newRequest = await installCorpusRelease(
      { ...request, requestKey: randomUUID() },
      createCorpusInstallRepository(connection.db),
    );
    expect(newRequest).toMatchObject({
      installId: plan.installId,
      completed: true,
    });
    expect(await countRows(connection.db, request.ownerId)).toEqual(before);
  });

  it('should execute the command and report actual SQL counts through default stdout', async () => {
    vi.stubEnv('DATABASE_URL', databaseUrl);
    const stdout = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true);
    const result = await runCorpusInstallCommand([
      '--owner-id',
      randomUUID(),
      '--release',
      '1.0.1',
      '--request-key',
      randomUUID(),
    ]);
    expect(result).toBe(0);
    expect(stdout.mock.calls).toEqual([
      [expect.stringContaining('"sqlStatements":')],
    ]);
  });

  it('should reject malformed requests and oversized snapshots before writing rows', async ({
    connection,
  }) => {
    const request = loadCorpusInstallRequest([
      '--owner-id',
      randomUUID(),
      '--release',
      '1.0.1',
      '--request-key',
      randomUUID(),
    ]);
    const repository = createCorpusInstallRepository(connection.db);
    await expect(repository.applyBatch(0)).rejects.toThrow();
    await expect(
      repository.inspect({ ...request, ownerId: '' }),
    ).rejects.toThrow();
    await expect(
      repository.inspect({ ...request, requestKey: 'not-a-uuid' }),
    ).rejects.toThrow();
    await expect(
      repository.inspect({
        ...request,
        sources: [
          {
            ...request.sources[0]!,
            payload: { oversized: 'x'.repeat(256 * 1024) },
          },
        ],
      }),
    ).rejects.toThrow();
    expect(
      await connection.db.corpusInstall.count({
        where: { ownerId: request.ownerId },
      }),
    ).toBe(0);
  });

  it(
    'should leave a dry-run owner empty and isolate another owner installation',
    { timeout: 300_000 },
    async ({ connection }) => {
      const request = loadCorpusInstallRequest([
        '--owner-id',
        randomUUID(),
        '--release',
        '1.0.1',
        '--request-key',
        randomUUID(),
      ]);
      const before = await countRows(connection.db, request.ownerId);
      const dryRun = await installCorpusRelease(
        { ...request, dryRun: true },
        createCorpusInstallRepository(connection.db),
      );
      expect(dryRun.predictedStatements).toBeGreaterThan(0);
      expect(await countRows(connection.db, request.ownerId)).toEqual(before);
      await installCorpusRelease(
        request,
        createCorpusInstallRepository(connection.db),
      );
      const original = await connection.db.knowledgeEntries.findMany({
        where: { ownerId: request.ownerId },
        orderBy: { id: 'asc' },
      });
      const foreign = { ...request, ownerId: randomUUID() };
      const foreignPlan = await installCorpusRelease(
        foreign,
        createCorpusInstallRepository(connection.db),
      );
      expect(
        foreignPlan.items.every((item) => item.disposition === 'created'),
      ).toBe(true);
      const foreignEntries = await connection.db.knowledgeEntries.findMany({
        where: { ownerId: foreign.ownerId },
      });
      expect(foreignEntries).toHaveLength(56);
      expect(
        foreignEntries.every(
          (entry) => !original.some((other) => other.id === entry.id),
        ),
      ).toBe(true);
      expect(
        await connection.db.knowledgeEntries.findMany({
          where: { ownerId: request.ownerId },
          orderBy: { id: 'asc' },
        }),
      ).toEqual(original);
    },
  );

  it('should roll back a crash before checkpoint and resume the same request', async ({
    connection,
  }) => {
    const request = loadCorpusInstallRequest([
      '--owner-id',
      randomUUID(),
      '--release',
      '1.0.1',
      '--request-key',
      randomUUID(),
    ]);
    const crash = new Error('simulated checkpoint crash');
    const repository = createCorpusInstallRepository(connection.db, {
      beforeCheckpoint: async (index) => {
        if (index === 1) {
          throw crash;
        }
      },
    });
    await expect(installCorpusRelease(request, repository)).rejects.toThrow(
      crash,
    );
    const interrupted = await createCorpusInstallRepository(
      connection.db,
    ).inspect(request);
    expect(interrupted).toMatchObject({ completed: false, checkpoint: 1 });
    expect(
      await connection.db.sources.count({
        where: { ownerId: request.ownerId },
      }),
    ).toBe(1);
    expect(
      await connection.db.sourceVersions.count({
        where: { ownerId: request.ownerId },
      }),
    ).toBe(1);
    const retry = createCorpusInstallRepository(connection.db);
    await expect(
      retry.inspect({ ...request, requestKey: randomUUID() }),
    ).rejects.toThrow();
    await expect(
      retry.inspect({
        ...request,
        release: { ...request.release, version: '9.0.0' },
      }),
    ).rejects.toThrow();
    await retry.inspect(request);
    await expect(retry.applyBatch(3)).rejects.toThrow();
    const committedRows = await countRows(connection.db, request.ownerId);
    await retry.applyBatch(0);
    expect(await countRows(connection.db, request.ownerId)).toEqual(
      committedRows,
    );
    const resumed = await installCorpusRelease(
      request,
      createCorpusInstallRepository(connection.db),
    );
    const completed = await createCorpusInstallRepository(
      connection.db,
    ).inspect(request);
    expect(completed).toMatchObject({
      installId: resumed.installId,
      completed: true,
    });
    expect(
      await connection.db.knowledgeEntries.count({
        where: { ownerId: request.ownerId },
      }),
    ).toBe(56);
    expect(
      await connection.db.corpusInstallItem.count({
        where: { installId: resumed.installId },
      }),
    ).toBe(56);
  });

  it('should append changed upstream drafts while preserving unchanged and collector-saved entries', async ({
    connection,
  }) => {
    const request = loadCorpusInstallRequest([
      '--owner-id',
      randomUUID(),
      '--release',
      '1.0.1',
      '--request-key',
      randomUUID(),
    ]);
    await installCorpusRelease(
      request,
      createCorpusInstallRepository(connection.db),
    );
    const installed = await connection.db.corpusInstallItem.findMany({
      where: { install: { ownerId: request.ownerId } },
      orderBy: { contentId: 'asc' },
    });
    const [updated, conflict] = installed;
    expect(updated).toBeDefined();
    expect(conflict).toBeDefined();
    await connection.db.$transaction(async (tx) => {
      const repository = createKnowledgeV2Repository(tx, request.ownerId);
      const detail = await repository.getV2(conflict!.entryId);
      expect(detail).not.toBeNull();
      await repository.addRevisionV2({
        entryId: conflict!.entryId,
        content: detail!.content,
        status: 'saved',
        savedBy: 'collector',
        reviewedBy: null,
        reviewedAt: null,
        expectedRevision: detail!.revision,
      });
    });
    const collectorHead =
      await connection.db.knowledgeEntries.findUniqueOrThrow({
        where: { id: conflict!.entryId },
      });
    const directory = createUpgradeDirectory(
      new Set([updated!.contentId, conflict!.contentId]),
    );
    try {
      const upgrade = loadCorpusInstallRequest([
        '--owner-id',
        request.ownerId,
        '--release',
        '1.0.2',
        '--request-key',
        randomUUID(),
        '--dir',
        directory,
      ]);
      const plan = await installCorpusRelease(
        upgrade,
        createCorpusInstallRepository(connection.db),
      );
      expect(
        plan.items.filter((item) => item.disposition === 'unchanged'),
      ).toHaveLength(54);
      expect(
        plan.items.filter((item) => item.disposition === 'update_draft'),
      ).toEqual([
        { contentId: updated!.contentId, disposition: 'update_draft' },
      ]);
      expect(
        plan.items.filter((item) => item.disposition === 'conflict'),
      ).toEqual([{ contentId: conflict!.contentId, disposition: 'conflict' }]);
      expect(
        await connection.db.knowledgeEntries.findUniqueOrThrow({
          where: { id: updated!.entryId },
        }),
      ).toMatchObject({ currentRevision: 2, latestSavedRevision: null });
      expect(
        await connection.db.knowledgeEntries.findUniqueOrThrow({
          where: { id: conflict!.entryId },
        }),
      ).toEqual(collectorHead);
      expect(
        await connection.db.knowledgeRevisions.findUniqueOrThrow({
          where: {
            entryId_revision: { entryId: updated!.entryId, revision: 2 },
          },
        }),
      ).toMatchObject({ status: 'draft', savedBy: null });
      const diffs = await connection.db.reviewDiff.findMany({
        where: { ownerId: request.ownerId },
      });
      expect(diffs).toHaveLength(2);
      expect(
        diffs.every(
          (diff) =>
            diff.status === 'pending' &&
            diff.baseRevision === 1 &&
            diff.baseContentHash !== null,
        ),
      ).toBe(true);
      for (const diff of diffs) {
        const pinned = await connection.db.knowledgeRevisions.findUniqueOrThrow(
          {
            where: {
              entryId_revision: {
                entryId: diff.entryId,
                revision: diff.candidateRevision,
              },
            },
          },
        );
        expect(diff.candidateContentHash).toBe(pinned.contentHash);
      }
      const subsequent = {
        ...upgrade,
        requestKey: randomUUID(),
        release: {
          ...upgrade.release,
          version: '1.0.3',
          manifestHash: sha256(upgrade.release.manifestHash),
        },
      };
      const next = await installCorpusRelease(
        subsequent,
        createCorpusInstallRepository(connection.db),
      );
      expect(
        next.items.filter((item) => item.disposition === 'conflict'),
      ).toHaveLength(1);
      expect(
        next.items.filter((item) => item.disposition === 'unchanged'),
      ).toHaveLength(55);
      expect(
        await connection.db.reviewDiff.findFirst({
          where: { entryId: conflict!.entryId },
        }),
      ).toMatchObject({
        changes: { previous: expect.any(Object), incoming: expect.any(Object) },
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('should preserve existing collector drafts without a prior receipt and keep related taxonomy pending', async ({
    connection,
  }) => {
    const request = fixtureRequest();
    const first = request.entries[0]!;
    const repository = createCorpusInstallRepository(connection.db);
    await repository.inspect(request);
    for (let index = 0; index <= request.sources.length; index += 1) {
      await repository.applyBatch(index);
    }
    const content = createCorpusContent(request.ownerId, request.sources).entry(
      first,
    );
    const entryId = corpusId(request.ownerId, first.id);
    await connection.db.$transaction(async (tx) => {
      await createKnowledgeV2Repository(tx, request.ownerId).createV2({
        entryId,
        displayCode: 'COLLECTOR',
        content,
        status: 'draft',
        savedBy: null,
        reviewedBy: null,
        reviewedAt: null,
      });
      await tx.knowledgeEntries.update({
        where: { id: entryId },
        data: { contentId: first.id },
      });
    });
    const plan = await installCorpusRelease(
      request,
      createCorpusInstallRepository(connection.db),
    );
    expect(plan.items.find((item) => item.contentId === first.id)).toEqual({
      contentId: first.id,
      disposition: 'conflict',
    });
    expect(
      await connection.db.knowledgeRevisions.count({ where: { entryId } }),
    ).toBe(1);
    expect(
      await connection.db.topicRelation.count({
        where: { ownerId: request.ownerId },
      }),
    ).toBe(1);
    expect(
      await connection.db.knowledgeRevisions.findFirst({
        where: {
          knowledgeEntries: { ownerId: request.ownerId },
          editorialReviewedBy: 'fixture-editor',
        },
      }),
    ).toMatchObject({
      status: 'draft',
      savedBy: null,
      editorialReviewedAt: new Date('2026-10-18T00:00:00.000Z'),
    });
    expect(
      await connection.db.authorityMapping.count({
        where: { ownerId: request.ownerId },
      }),
    ).toBe(0);
    expect(
      await connection.db.reviewDiff.findFirst({
        where: { ownerId: request.ownerId },
      }),
    ).toMatchObject({
      status: 'pending',
      baseRevision: 1,
      candidateRevision: 1,
      baseContentHash: null,
    });
    await connection.db.$transaction(async (tx) => {
      const cached = await preloadCorpusReferences(
        tx,
        request.ownerId,
        content,
      );
      expect(
        await createKnowledgeV2Repository(
          cached,
          request.ownerId,
        ).validateV2References(content),
      ).toBe(true);
      expect(await cached.citations.count()).toBeGreaterThan(0);
      expect(
        await cached.citations.findFirst({
          where: { id: content.citations[0]!.id },
          select: { id: true },
        }),
      ).toEqual({ id: content.citations[0]!.id });
      expect(
        await cached.citations.findFirst({ where: { id: randomUUID() } }),
      ).toBeNull();
      const tampered = {
        ...content,
        citations: content.citations.map((citation) => ({
          ...citation,
          quote: 'tampered captured quote',
        })),
      };
      expect(
        await createKnowledgeV2Repository(
          cached,
          request.ownerId,
        ).validateV2References(tampered),
      ).toBe(false);
      const metadata = {
        ...content,
        citations: content.citations.map((citation) => ({
          ...citation,
          source: { ...citation.source, title: 'Forged source metadata' },
        })),
      };
      expect(
        await createKnowledgeV2Repository(
          cached,
          request.ownerId,
        ).validateV2References(metadata),
      ).toBe(false);
      const foreign = await preloadCorpusReferences(tx, randomUUID(), content);
      expect(
        await createKnowledgeV2Repository(
          foreign,
          randomUUID(),
        ).validateV2References(content),
      ).toBe(false);
    });
    const changed = {
      ...request,
      requestKey: randomUUID(),
      release: {
        ...request.release,
        version: '1.0.1',
        manifestHash: sha256(request.release.manifestHash),
      },
      sources: request.sources.map((source, index) =>
        index === 0
          ? { ...source, title: 'Changed metadata with same payload' }
          : source,
      ),
    };
    const changedRepository = createCorpusInstallRepository(connection.db);
    await changedRepository.inspect(changed);
    await expect(changedRepository.applyBatch(0)).rejects.toThrow();
    expect(
      await connection.db.corpusInstall.count({
        where: { ownerId: request.ownerId },
      }),
    ).toBe(1);
  });

  it('should upgrade changed source bibliography while preserving the original immutable snapshot', async ({
    connection,
  }) => {
    const fixture = fixtureRequest();
    const source = {
      ...fixture.sources[0]!,
      title: 'Original catalogue title',
      contributors: ['Original author', 'Removed author'],
      languages: ['en', 'zh-Hant'],
    };
    const request = rehashRequest({
      ...fixture,
      sources: [source],
      entries: [fixture.entries[0]!],
      topics: fixture.topics.slice(0, 2),
    });
    await installCorpusRelease(
      request,
      createCorpusInstallRepository(connection.db),
    );
    const sourceId = createCorpusContent(
      request.ownerId,
      request.sources,
    ).sourceId(source);
    const original = await connection.db.sourceVersions.findFirstOrThrow({
      where: { ownerId: request.ownerId, sourceId },
    });
    expect(original.metadataSnapshot).toMatchObject({
      title: source.title,
      contributors: [
        {
          nameAsPrinted: 'Original author',
          role: 'author',
          attribution: 'credited',
        },
        {
          nameAsPrinted: 'Removed author',
          role: 'author',
          attribution: 'credited',
        },
      ],
      languages: ['en', 'zh-Hant'],
    });
    const payload = {
      description: source.locators[0]!.excerpt,
      imageUrl: source.images[0]!.remoteUrl,
      catalogueRevision: 2,
    };
    const payloadHash = sha256(canonicalJson(payload));
    const replacement = {
      ...source,
      title: 'Revised catalogue title',
      contributors: ['Replacement author'],
      languages: ['en', 'zh-Hans'],
      payload,
      payloadHash,
      citations: source.citations.map((citation) => ({
        ...citation,
        payloadHash,
      })),
    };
    const upgrade = rehashRequest({
      ...request,
      requestKey: randomUUID(),
      release: { ...request.release, version: '1.0.1' },
      sources: [replacement],
    });
    const installed = await installCorpusRelease(
      upgrade,
      createCorpusInstallRepository(connection.db),
    );
    expect(installed.items).toEqual([
      { contentId: request.entries[0]!.id, disposition: 'update_draft' },
    ]);
    const versionId = createCorpusContent(
      request.ownerId,
      upgrade.sources,
    ).versionId(replacement);
    const current = await connection.db.sourceVersions.findUniqueOrThrow({
      where: { id: versionId },
    });
    expect(current.metadataSnapshot).toMatchObject({
      title: replacement.title,
      contributors: [
        {
          nameAsPrinted: 'Replacement author',
          role: 'author',
          attribution: 'credited',
        },
      ],
      languages: ['en', 'zh-Hans'],
    });
    expect(
      await connection.db.sourceVersions.findUniqueOrThrow({
        where: { id: original.id },
      }),
    ).toEqual(original);
    expect(
      await connection.db.sourceVersions.count({
        where: { ownerId: request.ownerId, sourceId },
      }),
    ).toBe(2);
    await connection.db.$transaction(async (tx) => {
      const detail = await createKnowledgeV2Repository(
        tx,
        request.ownerId,
      ).getV2(corpusId(request.ownerId, request.entries[0]!.id));
      expect(detail).toMatchObject({
        revision: 2,
        status: 'draft',
        savedBy: null,
        content: {
          citations: [
            expect.objectContaining({
              locator: expect.objectContaining({ sourceVersionId: versionId }),
              source: expect.objectContaining({
                versionId,
                title: replacement.title,
                contributors: replacement.contributors,
                languages: replacement.languages,
              }),
            }),
          ],
        },
      });
    });
  });

  it('should reject a release changed between planning and committing its first batch', async ({
    connection,
  }) => {
    const original = fixtureRequest();
    const request = {
      ...original,
      sources: [],
      entries: [],
      topics: [],
      release: {
        ...original.release,
        publishedAt: '2026-10-18T00:00:00.000Z',
        reviewer: 'editor',
      },
    };
    const first = createCorpusInstallRepository(connection.db);
    const conflicting = createCorpusInstallRepository(connection.db);
    await first.inspect(request);
    await conflicting.inspect({
      ...request,
      ownerId: randomUUID(),
      release: { ...request.release, manifestHash: 'f'.repeat(64) },
    });
    await first.applyBatch(0);
    await first.applyBatch(0);
    await expect(conflicting.applyBatch(0)).rejects.toThrow();
    expect(
      await connection.db.corpusRelease.findFirst({
        where: { corpusId: request.release.corpusId },
      }),
    ).toMatchObject({
      status: 'published',
      editorialReviewer: 'editor',
      manifestHash: request.release.manifestHash,
    });
  });

  it('should refuse changed manifest bytes under the same published version', async ({
    connection,
  }) => {
    const request = loadCorpusInstallRequest([
      '--owner-id',
      randomUUID(),
      '--release',
      '1.0.1',
      '--request-key',
      randomUUID(),
    ]);
    await installCorpusRelease(
      request,
      createCorpusInstallRepository(connection.db),
    );
    const before = await countRows(connection.db, request.ownerId);
    const changed: CorpusInstallRequest = {
      ...request,
      release: { ...request.release, manifestHash: '0'.repeat(64) },
    };
    await expect(
      installCorpusRelease(
        changed,
        createCorpusInstallRepository(connection.db),
      ),
    ).rejects.toThrow();
    expect(await countRows(connection.db, request.ownerId)).toEqual(before);
  });
});

/**
 * Captures owner-scoped row totals across the persisted installation graph.
 * @param db connected test database
 * @param ownerId isolated collector identity
 * @returns row-count snapshot for zero-growth retry assertions
 */
async function countRows(
  db: Database,
  ownerId: string,
): Promise<readonly number[]> {
  return Promise.all([
    db.corpusRelease.count({
      where: { corpusInstallRelease: { some: { ownerId } } },
    }),
    db.corpusInstall.count({ where: { ownerId } }),
    db.corpusInstallItem.count({ where: { install: { ownerId } } }),
    db.knowledgeEntries.count({ where: { ownerId } }),
    db.knowledgeRevisions.count({ where: { knowledgeEntries: { ownerId } } }),
    db.sources.count({ where: { ownerId } }),
    db.sourceVersions.count({ where: { ownerId } }),
    db.citations.count({ where: { sourceLocators: { sources: { ownerId } } } }),
    db.sourceLocators.count({ where: { sources: { ownerId } } }),
    db.topic.count({ where: { ownerId } }),
    db.topicLabel.count({ where: { ownerId } }),
    db.topicRelation.count({ where: { ownerId } }),
    db.authorityMapping.count({ where: { ownerId } }),
    db.externalObject.count({ where: { ownerId } }),
    db.citedClaim.count({ where: { ownerId } }),
    db.citedClaimCitation.count({ where: { claim: { ownerId } } }),
    db.languageVariant.count({ where: { claim: { ownerId } } }),
    db.knowledgeRevisionTopic.count({ where: { ownerId } }),
    db.knowledgeRevisionAliases.count({
      where: { knowledgeEntries: { ownerId } },
    }),
    db.knowledgeRevisionCitations.count({
      where: { knowledgeEntries: { ownerId } },
    }),
    db.knowledgeRevisionKinds.count({
      where: { knowledgeEntries: { ownerId } },
    }),
    db.knowledgeRevisionMethods.count({
      where: { knowledgeEntries: { ownerId } },
    }),
    db.sourceContributors.count({ where: { sources: { ownerId } } }),
    db.sourceLanguages.count({ where: { sources: { ownerId } } }),
    db.referenceImages.count({ where: { sourceVersions: { ownerId } } }),
    db.reviewDiff.count({ where: { ownerId } }),
  ]);
}

/**
 * builds a subsequent release by editing upstream titles and rehashing every member
 * @param changedContentIds content identities requiring an upstream change
 * @returns disposable directory owned by the calling test
 */
function createUpgradeDirectory(
  changedContentIds: ReadonlySet<string>,
): string {
  const directory = mkdtempSync(join(tmpdir(), 'antica-kdb09-upgrade-'));
  cpSync(
    fileURLToPath(new URL('../../../corpus/antica/v1', import.meta.url)),
    directory,
    { recursive: true },
  );
  const releasePath = join(directory, 'releases/1.0.1.json');
  const release = corpusFileSchema.parse(
    JSON.parse(readFileSync(releasePath, 'utf8')),
  );
  if (release.kind !== 'release') {
    throw new Error('Expected release fixture');
  }
  for (const member of release.files.filter((file) =>
    file.path.startsWith('entries/'),
  )) {
    const path = join(directory, member.path);
    const entry = corpusFileSchema.parse(
      JSON.parse(readFileSync(path, 'utf8')),
    );
    if (entry.kind === 'entry' && changedContentIds.has(entry.id)) {
      writeFileSync(
        path,
        `${canonicalJson({
          ...entry,
          titles: entry.titles.map((title) => ({
            ...title,
            text: `${title.text} — revised`,
          })),
        })}\n`,
      );
    }
  }
  const { manifestHash: _oldHash, ...manifest } = release;
  const next = {
    ...manifest,
    version: '1.0.2',
    files: release.files.map((member) => ({
      ...member,
      sha256: sha256(readFileSync(join(directory, member.path), 'utf8')),
    })),
  };
  rmSync(releasePath);
  writeFileSync(
    join(directory, 'releases/1.0.2.json'),
    `${canonicalJson({ ...next, manifestHash: sha256(canonicalJson(next)) })}\n`,
  );

  return directory;
}

/**
 * Builds an isolated valid synthetic release for optional metadata and ownership cases.
 * @returns owner and release identity with fixture sources, entries and related topics
 */
function fixtureRequest(): CorpusInstallRequest {
  const files = createCorpusFixture().map((document) =>
    corpusFileSchema.parse(JSON.parse(document.text)),
  );
  const release = files.find((file) => file.kind === 'release')!;
  const taxonomy = files.find((file) => file.kind === 'taxonomy')!;

  return {
    ownerId: randomUUID(),
    requestKey: randomUUID(),
    release: { ...release, corpusId: `antica:test:${randomUUID()}` },
    sources: files.filter((file) => file.kind === 'source'),
    entries: files
      .filter((file) => file.kind === 'entry')
      .map((entry, index) =>
        index === 1
          ? {
              ...entry,
              editorialReview: {
                state: 'reviewed',
                actor: 'fixture-editor',
                at: '2026-10-18T00:00:00.000Z',
              },
            }
          : entry,
      ),
    topics: taxonomy.topics.map((topic, index) => ({
      ...topic,
      parentId: index === 1 ? taxonomy.topics[0]!.id : topic.parentId,
      relatedIds: index === 0 ? [taxonomy.topics[1]!.id] : [],
    })),
  };
}

/**
 * Rehashes the exact synthetic source, entry and taxonomy members for an application request.
 * @param request synthetic release with the new source payload already hashed
 * @returns release manifest pinned to its revised members
 */
function rehashRequest(request: CorpusInstallRequest): CorpusInstallRequest {
  const { manifestHash: _previousHash, ...release } = request.release;
  const manifest = {
    ...release,
    files: [
      ...request.sources.map((source, index) => ({
        path: `sources/${index}.json`,
        sha256: sha256(`${canonicalJson(source)}\n`),
      })),
      ...request.entries.map((entry, index) => ({
        path: `entries/${index}.json`,
        sha256: sha256(`${canonicalJson(entry)}\n`),
      })),
      {
        path: 'taxonomy.json',
        sha256: sha256(
          `${canonicalJson(JSON.parse(JSON.stringify({ formatVersion: 1, kind: 'taxonomy', topics: request.topics })))}\n`,
        ),
      },
    ].sort((left, right) => left.path.localeCompare(right.path)),
  };

  return {
    ...request,
    release: { ...manifest, manifestHash: sha256(canonicalJson(manifest)) },
  };
}
