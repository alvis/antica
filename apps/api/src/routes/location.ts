import { Hono } from 'hono';

import { locationCreateSchema } from '@antica/contracts';

import { invalid, jsonBody, respond } from '../http.js';

import type { LocationService } from '@antica/application/server';

import type { ApiEnv } from '../http.js';

const createdStatus = 201;

/**
 * registers authenticated collector location routes
 * @param service owner-scoped location operations
 * @returns location route group
 */
export function createLocationRoutes(service: LocationService): Hono<ApiEnv> {
  const router = new Hono<ApiEnv>();
  router.get('/', async (context) =>
    respond(context, await service.list(context.get('ownerId'))),
  );
  router.post('/', async (context) => {
    const input = locationCreateSchema.safeParse(await jsonBody(context));
    if (!input.success) {
      return invalid(context);
    }

    return respond(
      context,
      await service.create(context.get('ownerId'), input.data),
      createdStatus,
    );
  });

  return router;
}
