import { Hono } from 'hono';

import type { JobService } from '@antica/application/server';
import { respond } from '../http.js';
import type { ApiEnv } from '../http.js';

/** registers durable job status reads */
export function createJobRoutes(service: JobService): Hono<ApiEnv> {
  const router = new Hono<ApiEnv>();
  router.get('/jobs/:id', async (context) =>
    respond(
      context,
      await service.get(context.get('ownerId'), context.req.param('id')),
    ),
  );
  return router;
}
