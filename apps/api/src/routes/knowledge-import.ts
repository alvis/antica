import { Hono } from 'hono';
import { z } from 'zod';

import { knowledgeImportRequestSchema } from '@antica/contracts';

import { invalid, jsonBody, respond } from '../http.js';

import type { KnowledgeImportService } from '@antica/application/server';

import type { ApiEnv } from '../http.js';

const acceptedStatus = 202;

/**
 * mounts owner-authenticated import commands on the existing /v1 router
 * @param service reviewed provider import commands
 * @returns operator routes
 */
export function createKnowledgeImportRoutes(
  service: KnowledgeImportService,
): Hono<ApiEnv> {
  const router = new Hono<ApiEnv>();
  router.post('/knowledge/imports', async (context) => {
    const input = knowledgeImportRequestSchema.safeParse(
      await jsonBody(context),
    );
    if (!input.success) {
      return invalid(context);
    }

    return respond(
      context,
      await service.request(context.get('ownerId'), input.data),
      acceptedStatus,
    );
  });
  router.get('/knowledge/imports/:id', async (context) => {
    const id = z.uuid().safeParse(context.req.param('id'));
    if (!id.success) {
      return invalid(context);
    }

    return respond(context, await service.get(context.get('ownerId'), id.data));
  });
  router.post('/knowledge/imports/:id/resume', async (context) => {
    const id = z.uuid().safeParse(context.req.param('id'));
    if (!id.success) {
      return invalid(context);
    }

    return respond(
      context,
      await service.resume(context.get('ownerId'), id.data),
    );
  });
  router.post('/knowledge/imports/:id/cancel', async (context) => {
    const id = z.uuid().safeParse(context.req.param('id'));
    if (!id.success) {
      return invalid(context);
    }

    return respond(
      context,
      await service.cancel(context.get('ownerId'), id.data),
    );
  });

  return router;
}
