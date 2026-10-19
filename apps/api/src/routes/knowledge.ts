import { Hono } from 'hono';
import { z } from 'zod';

import {
  knowledgeQuerySchema,
  knowledgeReadV2Schema,
  knowledgeUpdateSchema,
  knowledgeUpdateV2Schema,
  knowledgeWriteSchema,
  knowledgeWriteV2Schema,
  sourceCommandSchema,
} from '@antica/contracts';

import { invalid, jsonBody, respond } from '../http.js';

import { registerKnowledgeSearchRoutes } from './knowledge-search.js';

import type { Context } from 'hono';

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
  registerKnowledgeSearchRoutes(router, knowledge);
  registerKnowledgeDetailRoutes(router, knowledge);

  return router;
}

/**
 * mounts source intake and source detail endpoints on the authenticated router
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
      await sources.get({
        ownerId: context.get('ownerId'),
        id: context.req.param('id'),
        versionId: query.data.versionId,
        pageId: query.data.pageId,
        cursor: query.data.pageCursor,
        limit: query.data.limit,
      }),
    );
  });
}

/**
 * mounts the filtered knowledge catalogue endpoint
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
 * mounts knowledge creation and revision detail endpoints
 * @param router API router receiving the endpoints
 * @param knowledge persistent knowledge operations
 */
function registerKnowledgeDetailRoutes(
  router: Hono<ApiEnv>,
  knowledge: KnowledgeService,
): void {
  router.post('/knowledge', async (context) => {
    const body = await jsonBody(context);
    const v2Input = knowledgeWriteV2Schema.safeParse(body);
    if (v2Input.success) {
      return respond(
        context,
        await knowledge.createV2(context.get('ownerId'), v2Input.data),
        createdStatus,
      );
    }
    const input = knowledgeWriteSchema.safeParse(body);
    if (!input.success) {
      return invalid(context);
    }

    return respond(
      context,
      await knowledge.create(context.get('ownerId'), input.data),
      createdStatus,
    );
  });
  router.get('/knowledge/:id', async (context) =>
    getKnowledgeDetail(context, knowledge),
  );
  router.patch('/knowledge/:id', async (context) => {
    const body = await jsonBody(context);
    const v2Input = knowledgeUpdateV2Schema.safeParse(body);
    if (v2Input.success) {
      return respond(
        context,
        await knowledge.updateV2(
          context.get('ownerId'),
          context.req.param('id'),
          v2Input.data,
        ),
      );
    }
    const input = knowledgeUpdateSchema.safeParse(body);
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

/**
 * Reads one knowledge revision and emits its persisted content ETag.
 * @param context authenticated request context
 * @param knowledge collector knowledge service
 * @returns HTTP knowledge response
 */
async function getKnowledgeDetail(
  context: Context<ApiEnv, '/knowledge/:id'>,
  knowledge: KnowledgeService,
): Promise<Response> {
  const ownerId = context.get('ownerId');
  const id = context.req.param('id');
  const v2Query = knowledgeReadV2Schema.safeParse(context.req.query());
  if (v2Query.success && context.req.query('methodVersionId') === undefined) {
    const read =
      v2Query.data.view === undefined && v2Query.data.revision !== undefined
        ? { ...v2Query.data, view: 'revision' as const }
        : v2Query.data;
    const result = await knowledge.getV2(ownerId, id, read);
    if (!result.success) {
      return respond(context, result);
    }
    const revision =
      'entry' in result.data.detail
        ? result.data.detail.entry.revision
        : result.data.detail.revision;
    context.header('ETag', `"${revision}-${result.data.contentHash}"`);

    return respond(context, { success: true, data: result.data.detail });
  }
  const query = knowledgeReadSchema.safeParse(context.req.query());
  if (!query.success) {
    return invalid(context);
  }
  if (knowledge.discovery) {
    return discoveredMethodDetail(context, knowledge.discovery, query.data);
  }
  const legacy = await knowledge.get(
    ownerId,
    id,
    query.data.revision,
    query.data.methodVersionId,
  );
  if (!legacy.success) {
    return respond(context, legacy);
  }
  const hash = await knowledge.getV2(ownerId, id, {
    view: 'revision',
    revision: legacy.data.entry.revision,
  });
  if (!hash.success) {
    return respond(context, hash);
  }
  context.header(
    'ETag',
    `"${legacy.data.entry.revision}-${hash.data.contentHash}"`,
  );

  return respond(context, legacy);
}

/**
 * serves a pinned legacy inspection method using the same bulk detail snapshot
 * @param context authenticated request
 * @param discovery bulk knowledge capabilities
 * @param query legacy revision and method selection
 * @returns legacy detail with persisted content ETag
 */
async function discoveredMethodDetail(
  context: Context<ApiEnv, '/knowledge/:id'>,
  discovery: NonNullable<KnowledgeService['discovery']>,
  query: z.infer<typeof knowledgeReadSchema>,
): Promise<Response> {
  const value = await discovery.detail(
    context.get('ownerId'),
    context.req.param('id'),
    { revision: query.revision },
  );
  if (!value || !('entry' in value.detail)) {
    return respond(context, {
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: 'Knowledge entry or requested version not found',
        retryable: false,
      },
    });
  }
  const detail = value.detail;
  const versions = detail.methodVersions.filter(
    (version) => version.id === query.methodVersionId,
  );
  if (versions.length === 0) {
    return respond(context, {
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: 'Knowledge entry or requested version not found',
        retryable: false,
      },
    });
  }
  context.header('ETag', `"${detail.entry.revision}-${value.contentHash}"`);

  return respond(context, {
    success: true,
    data: {
      ...detail,
      methods: detail.methods.filter((method) =>
        versions.some((version) => version.methodId === method.id),
      ),
      methodVersions: versions,
    },
  });
}
