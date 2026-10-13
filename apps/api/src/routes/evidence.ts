import { Hono } from 'hono';

import {
  checkCreateSchema,
  checkPatchSchema,
  evidenceCreateRequestSchema,
  observationInputSchema,
  entityIdSchema,
} from '@antica/contracts';
import type { EvidenceService } from '@antica/application/server';
import { invalid, jsonBody, respond } from '../http.js';
import type { ApiEnv } from '../http.js';

/** registers collector evidence, observation, and inspection routes */
export function createEvidenceRoutes(service: EvidenceService): Hono<ApiEnv> {
  const router = new Hono<ApiEnv>();
  router.post('/evidence', async (context) => {
    const input = evidenceCreateRequestSchema.safeParse(
      await jsonBody(context),
    );
    if (!input.success) {
      return invalid(context);
    }
    return respond(
      context,
      await service.createAnchor(context.get('ownerId'), input.data),
      input.data.mode === 'create' ? 201 : 202,
    );
  });
  router.post('/observations', async (context) => {
    const input = observationInputSchema.safeParse(await jsonBody(context));
    if (!input.success) {
      return invalid(context);
    }
    const key = entityIdSchema.safeParse(context.req.header('idempotency-key'));
    if (!key.success) {
      return invalid(context, 'Idempotency-Key');
    }
    return respond(
      context,
      await service.addObservation(
        context.get('ownerId'),
        key.data,
        input.data,
      ),
      201,
    );
  });
  router.get('/records/:id/observations', async (context) => {
    const rawLimit = context.req.query('limit');
    const limit = rawLimit === undefined ? undefined : Number(rawLimit);
    if (
      limit !== undefined &&
      (!Number.isInteger(limit) || limit < 1 || limit > 100)
    ) {
      return invalid(context, 'limit');
    }
    return respond(
      context,
      await service.observations(
        context.get('ownerId'),
        context.req.param('id'),
        context.req.query('cursor'),
        limit,
      ),
    );
  });
  router.post('/records/:id/checks', async (context) => {
    const input = checkCreateSchema.safeParse(await jsonBody(context));
    if (!input.success) {
      return invalid(context);
    }
    const key = entityIdSchema.safeParse(context.req.header('idempotency-key'));
    if (!key.success) {
      return invalid(context, 'Idempotency-Key');
    }
    return respond(
      context,
      await service.createCheck(
        context.get('ownerId'),
        context.req.param('id'),
        key.data,
        input.data,
      ),
      201,
    );
  });
  router.get('/checks/:id', async (context) =>
    respond(
      context,
      await service.getCheck(context.get('ownerId'), context.req.param('id')),
    ),
  );
  router.patch('/checks/:id', async (context) => {
    const input = checkPatchSchema.safeParse(await jsonBody(context));
    if (!input.success) {
      return invalid(context);
    }
    return respond(
      context,
      await service.updateCheck(
        context.get('ownerId'),
        context.req.param('id'),
        input.data,
      ),
    );
  });
  return router;
}
