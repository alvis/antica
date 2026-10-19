import { ok } from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { describe, expect, vi } from 'vitest';
import { z } from 'zod';

import { canonicalJsonSchema } from '@antica/contracts';

import { createKnowledgeImportRuntime } from '../../../knowledge-import.js';
import {
  createImportFixture,
  createRequest,
  it,
  requestRun,
} from '../../../routes/knowledge-import/fixtures/database.js';

import { createMetAdapter } from './adapter.js';

const capture = z
  .object({ body: z.record(z.string(), canonicalJsonSchema) })
  .parse(
    JSON.parse(
      readFileSync(new URL('./fixtures/53953.json', import.meta.url), 'utf8'),
    ),
  );

describe(
  'fn:createMetAdapter:durable import protocol',
  { timeout: 60_000 },
  () => {
    it('should defer a real adapter 429 through the framework without premature refetching', async ({
      database: { db },
    }) => {
      const request = vi.fn<typeof fetch>(async () =>
        Response.json(capture.body),
      );
      request.mockImplementationOnce(
        async () =>
          new Response(null, {
            status: 429,
            headers: { 'Retry-After': '120' },
          }),
      );
      const fixture = createImportFixture(db, createMetAdapter({ request }));
      const input = createRequest(['53953']);
      const run = await requestRun(fixture, {
        ...input,
        selection: { ...input.selection, provider: 'met' },
      });

      await fixture.handle(run.jobId);
      expect(await fixture.store.get(fixture.ownerId, run.id)).toMatchObject({
        retryAfter: '2026-10-19T00:02:00.000Z',
        counts: { imported: 0 },
      });
      await fixture.handle(run.jobId);
      expect(request).toHaveBeenCalledTimes(1);
      expect(
        await db.sourceVersions.count({ where: { ownerId: fixture.ownerId } }),
      ).toBe(0);
      fixture.clock.value = '2026-10-19T00:02:01.000Z';
      await fixture.handle(run.jobId);
      expect(await fixture.store.get(fixture.ownerId, run.id)).toMatchObject({
        status: 'completed',
        counts: { imported: 1 },
      });
      expect(
        await db.knowledgeRevisions.findMany({
          where: { knowledgeEntries: { ownerId: fixture.ownerId } },
        }),
      ).toMatchObject([{ status: 'draft', savedBy: null }]);
    });

    it('should finish bounded listing before detail ingest and avoid relisting after completion', async ({
      database: { db },
    }) => {
      const urls: string[] = [];
      const request = vi.fn<typeof fetch>(async (input) => {
        const url = new URL(String(input));
        urls.push(url.pathname);
        if (url.searchParams.has('q')) {
          return Response.json({ total: 1, objectIDs: [53953] });
        }

        return Response.json(capture.body);
      });
      const fixture = createImportFixture(db, createMetAdapter({ request }));
      const run = await requestRun(fixture, {
        requestKey: randomUUID(),
        sqlOperationBudget: 4_000,
        selection: {
          kind: 'query',
          provider: 'met',
          query: { category: 'ceramics', text: 'China' },
          maxObjects: 1,
          maxBytes: 2_097_152,
          deadline: '2026-10-20T00:00:00.000Z',
        },
      });
      await fixture.handle(run.jobId);
      const listed = await fixture.store.get(fixture.ownerId, run.id);
      ok(listed);
      if (listed.status !== 'completed') {
        await fixture.handle(run.jobId);
      }
      await fixture.handle(run.jobId);
      expect(urls).toEqual([
        '/public/collection/v1.1/search',
        '/public/collection/v1/objects/53953',
      ]);
      expect(await fixture.store.get(fixture.ownerId, run.id)).toMatchObject({
        status: 'completed',
        counts: { imported: 1 },
      });
    });
    it('should freeze unique query IDs before detail deferral, retain shared accession objects and avoid duplicate content on recheck', async ({
      database: { db },
    }) => {
      const urls: string[] = [];
      const request = vi.fn<typeof fetch>(async (input) => {
        const url = new URL(String(input));
        urls.push(url.pathname);
        if (url.pathname.endsWith('/search')) {
          return Response.json({ total: 2, objectIDs: [53953, 39637] });
        }
        const objectID = Number(url.pathname.split('/').at(-1));

        return Response.json({
          ...capture.body,
          objectID,
          objectURL: `https://www.metmuseum.org/art/collection/search/${objectID}`,
        });
      });
      request.mockImplementationOnce(async (input) => {
        urls.push(z.instanceof(URL).parse(input).pathname);

        return Response.json({ total: 2, objectIDs: [53953, 39637] });
      });
      request.mockImplementationOnce(async (input) => {
        urls.push(z.instanceof(URL).parse(input).pathname);

        return new Response(null, {
          status: 429,
          headers: { 'Retry-After': '120' },
        });
      });
      const fixture = createImportFixture(db, createMetAdapter({ request }));
      const run = await requestRun(fixture, {
        requestKey: randomUUID(),
        sqlOperationBudget: 4_000,
        selection: {
          kind: 'query',
          provider: 'met',
          query: { text: 'bell' },
          maxObjects: 3,
          maxBytes: 2_097_152,
          deadline: '2026-10-20T00:00:00.000Z',
        },
      });
      await fixture.handle(run.jobId);
      const frozen = await db.importRun.findUniqueOrThrow({
        where: { id: run.id },
      });
      expect(frozen.cursor).toMatchObject({
        listed: true,
        manifest: ['53953', '39637'],
        offset: 1,
      });
      expect(
        await db.sourceVersions.count({ where: { ownerId: fixture.ownerId } }),
      ).toBe(0);
      fixture.clock.value = '2026-10-19T00:02:01.000Z';
      await fixture.handle(run.jobId);
      await fixture.handle(run.jobId);
      expect(urls).toEqual([
        '/public/collection/v1.1/search',
        '/public/collection/v1/objects/53953',
        '/public/collection/v1/objects/39637',
        '/public/collection/v1/objects/53953',
      ]);
      expect(await fixture.store.get(fixture.ownerId, run.id)).toMatchObject({
        status: 'completed',
        counts: { imported: 2 },
      });
      expect(
        (
          await db.externalObject.findMany({
            where: { ownerId: fixture.ownerId },
            orderBy: { objectId: 'asc' },
          })
        ).map(({ objectId }) => objectId),
      ).toEqual(['39637', '53953']);
      const revisions = await db.knowledgeRevisions.findMany({
        where: { knowledgeEntries: { ownerId: fixture.ownerId } },
        orderBy: [{ entryId: 'asc' }, { revision: 'asc' }],
      });
      expect(revisions).toHaveLength(2);
      expect(revisions).toMatchObject([
        { status: 'draft', savedBy: null },
        { status: 'draft', savedBy: null },
      ]);
      const images = await db.referenceImages.findMany({
        where: { sourceVersions: { ownerId: fixture.ownerId } },
        orderBy: { id: 'asc' },
      });
      const expectedUrls = z
        .array(z.string())
        .parse([
          capture.body.primaryImage,
          capture.body.primaryImageSmall,
          ...z.array(z.string()).parse(capture.body.additionalImages),
        ]);
      expect(
        images.map(({ externalImageUrl }) => externalImageUrl).sort(),
      ).toEqual([...expectedUrls, ...expectedUrls].sort());
      const input = createRequest(['53953', '39637']);
      const recheck = await requestRun(fixture, {
        ...input,
        selection: { ...input.selection, provider: 'met' },
      });
      await fixture.handle(recheck.jobId);
      expect(
        await fixture.store.get(fixture.ownerId, recheck.id),
      ).toMatchObject({
        status: 'completed',
        counts: { unchanged: 2, imported: 0 },
      });
      expect(
        await db.sourceVersions.count({ where: { ownerId: fixture.ownerId } }),
      ).toBe(2);
      expect(
        await db.knowledgeRevisions.findMany({
          where: { knowledgeEntries: { ownerId: fixture.ownerId } },
          orderBy: [{ entryId: 'asc' }, { revision: 'asc' }],
        }),
      ).toEqual(revisions);
      expect(
        await db.referenceImages.findMany({
          where: { sourceVersions: { ownerId: fixture.ownerId } },
          orderBy: { id: 'asc' },
        }),
      ).toEqual(images);
    });

    it('should allow Met and link only active labels belonging to the importing owner', async ({
      database: { db },
    }) => {
      const ownerId = randomUUID();
      const otherOwnerId = randomUUID();
      const activeId = randomUUID();
      const retiredId = randomUUID();
      const foreignId = randomUUID();
      await db.topic.createMany({
        data: [
          { id: activeId, ownerId, contentId: 'active', facet: 'object_type' },
          {
            id: retiredId,
            ownerId,
            contentId: 'retired',
            facet: 'object_type',
            retiredAt: new Date(),
          },
          {
            id: foreignId,
            ownerId: otherOwnerId,
            contentId: 'foreign',
            facet: 'object_type',
          },
        ],
      });
      await db.topicLabel.createMany({
        data: [
          {
            id: randomUUID(),
            ownerId,
            topicId: activeId,
            language: 'en',
            text: 'Yoke bell',
            normalizedText: 'yoke bell',
            kind: 'preferred',
          },
          {
            id: randomUUID(),
            ownerId,
            topicId: retiredId,
            language: 'en',
            text: 'Yoke bell',
            normalizedText: 'yoke bell',
            kind: 'preferred',
          },
          {
            id: randomUUID(),
            ownerId: otherOwnerId,
            topicId: foreignId,
            language: 'en',
            text: 'Yoke bell',
            normalizedText: 'yoke bell',
            kind: 'preferred',
          },
        ],
      });
      const runtime = createKnowledgeImportRuntime(
        {
          database: { db, close: async () => {} },
          clock: { now: () => '2026-10-19T00:00:00.000Z' },
        },
        {
          request: async () => Response.json(capture.body),
          topics: [
            { topicId: foreignId, facet: 'object_type', text: 'Yoke bell' },
          ],
        },
      );
      const input = createRequest(['53953']);
      expect(await runtime.service.request(ownerId, input)).toMatchObject({
        success: false,
      });
      const result = await runtime.service.request(ownerId, {
        ...input,
        requestKey: randomUUID(),
        selection: { ...input.selection, provider: 'met' },
      });
      ok(result.success);
      await runtime.handle(result.data.jobId);
      await runtime.handle(result.data.jobId);
      const revision = await db.knowledgeRevisions.findFirstOrThrow({
        where: { knowledgeEntries: { ownerId } },
      });
      expect(revision.content).toMatchObject({
        topics: [{ topicId: activeId, applicability: 'specific' }],
      });
      expect(revision).toMatchObject({ status: 'draft', savedBy: null });
      const run = await runtime.service.get(ownerId, result.data.id);
      expect(run).toMatchObject({
        success: true,
        data: { status: 'completed', counts: { imported: 1 } },
      });
      ok(run.success);
      const baselineTopicId = randomUUID();
      const baseline = createImportFixture(
        db,
        createMetAdapter({
          request: async () => Response.json(capture.body),
          topics: [
            {
              topicId: baselineTopicId,
              facet: 'object_type',
              text: 'Yoke bell',
            },
          ],
        }),
      );
      await db.topic.create({
        data: {
          id: baselineTopicId,
          ownerId: baseline.ownerId,
          contentId: 'baseline',
          facet: 'object_type',
        },
      });
      const baselineRun = await requestRun(baseline, {
        ...input,
        requestKey: randomUUID(),
        selection: { ...input.selection, provider: 'met' },
      });
      await baseline.handle(baselineRun.jobId);
      const baselineStatus = await baseline.store.get(
        baseline.ownerId,
        baselineRun.id,
      );
      ok(baselineStatus);
      expect(run.data.counts.sqlOperations).toBe(
        baselineStatus.counts.sqlOperations + 1,
      );
    });
  },
);
