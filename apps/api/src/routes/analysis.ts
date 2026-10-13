import { Hono } from 'hono';

import {
  actionResolutionRequestSchema,
  applyAnalysisChangesSchema,
  entityIdSchema,
  requestAnalysisSchema,
  taskQuerySchema,
} from '@antica/contracts';
import type { AnalysisService } from '@antica/application/server';
import { invalid, jsonBody, respond } from '../http.js';
import type { ApiEnv } from '../http.js';

/** registers explicit analysis and collector review commands */
export function createAnalysisRoutes(service: AnalysisService): Hono<ApiEnv> {
  const router = new Hono<ApiEnv>();
  router.post('/records/:id/analyses', async (context) => {
    const input = requestAnalysisSchema.safeParse(await jsonBody(context));
    const key = entityIdSchema.safeParse(context.req.header('idempotency-key'));
    if (!input.success || !key.success) {
      return invalid(context);
    }
    return respond(
      context,
      await service.request(
        context.get('ownerId'),
        context.req.param('id'),
        key.data,
        input.data,
      ),
      202,
    );
  });
  router.get('/analyses/:id', async (context) =>
    respond(
      context,
      await service.get(context.get('ownerId'), context.req.param('id')),
    ),
  );
  router.post('/analyses/:id/apply', async (context) => {
    const input = applyAnalysisChangesSchema.safeParse(await jsonBody(context));
    const key = entityIdSchema.safeParse(context.req.header('idempotency-key'));
    if (!input.success || !key.success) {
      return invalid(context);
    }
    return respond(
      context,
      await service.apply(
        context.get('ownerId'),
        context.req.param('id'),
        key.data,
        input.data,
      ),
    );
  });
  router.patch('/analyses/:runId/actions/:actionId', async (context) => {
    const input = actionResolutionRequestSchema.safeParse(
      await jsonBody(context),
    );
    const key = entityIdSchema.safeParse(context.req.header('idempotency-key'));
    if (!input.success || !key.success) {
      return invalid(context);
    }
    return respond(
      context,
      await service.resolveAction(
        context.get('ownerId'),
        context.req.param('runId'),
        context.req.param('actionId'),
        key.data,
        input.data,
      ),
    );
  });
  router.get('/tasks', async (context) => {
    const query = taskQuerySchema.safeParse({
      recordId: context.req.query('recordId'),
      actionStatus: context.req.query('actionStatus'),
      cursor: context.req.query('cursor'),
      limit:
        context.req.query('limit') === undefined
          ? undefined
          : Number(context.req.query('limit')),
    });
    if (!query.success) {
      return invalid(context);
    }
    return respond(
      context,
      await service.tasks(context.get('ownerId'), query.data),
    );
  });
  return router;
}
