import { Hono } from 'hono';

import {
  collectionQuerySchema,
  entityIdSchema,
  recordCreateSchema,
  recordHistoryQuerySchema,
  recordPatchSchema,
} from '@antica/contracts';
import type { RecordService } from '@antica/application/server';
import { invalid, jsonBody, respond } from '../http.js';
import type { ApiEnv } from '../http.js';

/** registers collection routes against an authenticated service */
export function createRecordRoutes(service: RecordService): Hono<ApiEnv> {
  const router = new Hono<ApiEnv>();
  router.get('/', async (context) => {
    const query = collectionQuerySchema.safeParse({
      cursor: context.req.query('cursor'),
      limit:
        context.req.query('limit') === undefined
          ? undefined
          : Number(context.req.query('limit')),
      text: context.req.query('text'),
      sort: context.req.query('sort'),
      freshness: context.req.query('freshness'),
      hasPendingChecks:
        context.req.query('hasPendingChecks') === undefined
          ? undefined
          : context.req.query('hasPendingChecks') === 'true',
      locationId: context.req.query('locationId'),
      categoryIds: context.req.queries('categoryIds'),
      materialIds: context.req.queries('materialIds'),
      periodIds: context.req.queries('periodIds'),
      tags: context.req.queries('tags'),
    });
    if (!query.success) {
      return invalid(context);
    }
    return respond(
      context,
      await service.list(context.get('ownerId'), query.data),
    );
  });
  router.post('/', async (context) => {
    const input = recordCreateSchema.safeParse(await jsonBody(context));
    if (!input.success) {
      return invalid(context);
    }
    const key = context.req.header('idempotency-key');
    if (!key) {
      return invalid(context, 'Idempotency-Key');
    }
    return respond(
      context,
      await service.create(context.get('ownerId'), key, input.data),
      201,
    );
  });
  router.get('/:id', async (context) =>
    respond(
      context,
      await service.get(context.get('ownerId'), context.req.param('id')),
    ),
  );
  router.get('/:id/history', async (context) => {
    const rawLimit = context.req.query('limit');
    const id = entityIdSchema.safeParse(context.req.param('id'));
    const query = recordHistoryQuerySchema.safeParse({
      cursor: context.req.query('cursor'),
      limit: rawLimit === undefined ? undefined : Number(rawLimit),
    });
    if (!id.success || !query.success) {
      return invalid(context);
    }
    return respond(
      context,
      await service.history(context.get('ownerId'), id.data, query.data),
    );
  });
  router.patch('/:id', async (context) => {
    const input = recordPatchSchema.safeParse(await jsonBody(context));
    if (!input.success) {
      return invalid(context);
    }
    const key = context.req.header('idempotency-key');
    if (!key) {
      return invalid(context, 'Idempotency-Key');
    }
    return respond(
      context,
      await service.patch(
        context.get('ownerId'),
        context.req.param('id'),
        key,
        input.data,
      ),
    );
  });
  return router;
}
