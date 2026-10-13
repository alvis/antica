import { Hono } from 'hono';
import { z } from 'zod';

import {
  knowledgeQuerySchema,
  knowledgeUpdateSchema,
  knowledgeWriteSchema,
  sourceCommandSchema,
} from '@antica/contracts';

import { invalid, jsonBody, respond } from '../http.js';

import type {
  KnowledgeService,
  SourceService,
} from '@antica/application/server';

import type { ApiEnv } from '../http.js';

const maximumPageSize = 100;
const acceptedStatus = 202;
const createdStatus = 201;
const sourceReadSchema = z
  .strictObject({
    versionId: z.uuid().optional(),
    pageId: z.uuid().optional(),
    pageCursor: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(maximumPageSize).optional(),
  })
  .refine((query) => !(query.pageId && query.pageCursor));
const knowledgeReadSchema = z.strictObject({
  revision: z.coerce.number().int().positive().optional(),
  methodVersionId: z.uuid().optional(),
});

/**
 * registers source intake and knowledge revision routes
 * @param sources persistent source service
 * @param knowledge collector knowledge service
 * @returns authenticated Hono routes
 */
export function createKnowledgeRoutes(
  sources: SourceService,
  knowledge: KnowledgeService,
): Hono<ApiEnv> {
  const router = new Hono<ApiEnv>();
  registerSourceRoutes(router, sources);
  registerKnowledgeListRoute(router, knowledge);
  registerKnowledgeDetailRoutes(router, knowledge);

  return router;
}

/**
 * Mounts source intake and source detail endpoints on the authenticated router.
 * @param router API router receiving the endpoints
 * @param sources persistent source operations
 */
function registerSourceRoutes(
  router: Hono<ApiEnv>,
  sources: SourceService,
): void {
  router.post('/sources', async (context) => {
    const input = sourceCommandSchema.safeParse(await jsonBody(context));
    if (!input.success) {
      return invalid(context);
    }

    return respond(
      context,
      await sources.submit(context.get('ownerId'), input.data),
      acceptedStatus,
    );
  });
  router.get('/sources/:id', async (context) => {
    const query = sourceReadSchema.safeParse(context.req.query());
    if (!query.success) {
      return invalid(context);
    }

    return respond(
      context,
      await sources.get(
        context.get('ownerId'),
        context.req.param('id'),
        query.data.versionId,
        query.data.pageId,
        query.data.pageCursor,
        query.data.limit,
      ),
    );
  });
}

/**
 * Mounts the filtered knowledge catalogue endpoint.
 * @param router API router receiving the endpoint
 * @param knowledge persistent knowledge operations
 */
function registerKnowledgeListRoute(
  router: Hono<ApiEnv>,
  knowledge: KnowledgeService,
): void {
  router.get('/knowledge', async (context) => {
    const includeUnknown = context.req.query('includeUnknown');
    if (
      includeUnknown !== undefined &&
      includeUnknown !== 'true' &&
      includeUnknown !== 'false'
    ) {
      return invalid(context, 'includeUnknown');
    }
    const hasFilters =
      [
        'sourceIds',
        'objectTypeIds',
        'materialIds',
        'periodIds',
        'regionIds',
      ].some((key) => context.req.queries(key) !== undefined) ||
      includeUnknown !== undefined;
    const query = knowledgeQuerySchema.safeParse({
      q: context.req.query('q'),
      kinds: context.req.queries('kinds'),
      status: context.req.query('status'),
      cursor: context.req.query('cursor'),
      limit:
        context.req.query('limit') === undefined
          ? undefined
          : Number(context.req.query('limit')),
      filters: hasFilters
        ? {
            sourceIds: context.req.queries('sourceIds'),
            objectTypeIds: context.req.queries('objectTypeIds'),
            materialIds: context.req.queries('materialIds'),
            periodIds: context.req.queries('periodIds'),
            regionIds: context.req.queries('regionIds'),
            includeUnknown:
              includeUnknown === undefined
                ? undefined
                : includeUnknown === 'true',
          }
        : undefined,
    });
    if (!query.success) {
      return invalid(context);
    }

    return respond(
      context,
      await knowledge.list(context.get('ownerId'), query.data),
    );
  });
}

/**
 * Mounts knowledge creation and revision detail endpoints.
 * @param router API router receiving the endpoints
 * @param knowledge persistent knowledge operations
 */
function registerKnowledgeDetailRoutes(
  router: Hono<ApiEnv>,
  knowledge: KnowledgeService,
): void {
  router.post('/knowledge', async (context) => {
    const input = knowledgeWriteSchema.safeParse(await jsonBody(context));
    if (!input.success) {
      return invalid(context);
    }

    return respond(
      context,
      await knowledge.create(context.get('ownerId'), input.data),
      createdStatus,
    );
  });
  router.get('/knowledge/:id', async (context) => {
    const query = knowledgeReadSchema.safeParse(context.req.query());
    if (!query.success) {
      return invalid(context);
    }

    return respond(
      context,
      await knowledge.get(
        context.get('ownerId'),
        context.req.param('id'),
        query.data.revision,
        query.data.methodVersionId,
      ),
    );
  });
  router.patch('/knowledge/:id', async (context) => {
    const input = knowledgeUpdateSchema.safeParse(await jsonBody(context));
    if (!input.success) {
      return invalid(context);
    }

    return respond(
      context,
      await knowledge.update(
        context.get('ownerId'),
        context.req.param('id'),
        input.data,
      ),
    );
  });
}
