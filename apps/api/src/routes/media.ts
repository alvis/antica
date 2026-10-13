import { Hono } from 'hono';

import {
  completeUploadRequestSchema,
  uploadRequestSchema,
} from '@antica/contracts';

import { invalid, jsonBody, respond } from '../http.js';

import type { MediaService } from '@antica/application/server';

import type { ApiEnv } from '../http.js';

/**
 * registers private media metadata and upload commands
 * @param service
 */
export function createMediaRoutes(service: MediaService): Hono<ApiEnv> {
  const router = new Hono<ApiEnv>();
  router.post('/uploads', async (context) => {
    const input = uploadRequestSchema.safeParse(await jsonBody(context));
    if (!input.success) {
      return invalid(context);
    }

    return respond(
      context,
      await service.start(context.get('ownerId'), input.data),
      201,
    );
  });
  router.post('/:id/complete', async (context) => {
    const input = completeUploadRequestSchema.safeParse(
      await jsonBody(context),
    );
    if (!input.success) {
      return invalid(context);
    }

    return respond(
      context,
      await service.complete(
        context.get('ownerId'),
        context.req.param('id'),
        input.data.requestKey,
        input.data.parts,
      ),
    );
  });
  router.get('/:id', async (context) =>
    respond(
      context,
      await service.get(context.get('ownerId'), context.req.param('id')),
    ),
  );

  return router;
}
