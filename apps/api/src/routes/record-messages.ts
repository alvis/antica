import { Hono } from 'hono';

import {
  recordMessageListQuerySchema,
  recordMessagePostSchema,
} from '@antica/contracts';

import { invalid, jsonBody, respond } from '../http.js';

import type { RecordMessageService } from '@antica/application/server';

import type { ApiEnv } from '../http.js';

/**
 * creates the routes of the per-record conversation
 * @param service owner-scoped conversation operations
 * @returns authenticated Hono routes to read the conversation and post to it
 */
export function createRecordMessageRoutes(
  service: RecordMessageService,
): Hono<ApiEnv> {
  const router = new Hono<ApiEnv>();
  router.get('/records/:id/messages', async (context) => {
    const limit = context.req.query('limit');
    const query = recordMessageListQuerySchema.safeParse({
      cursor: context.req.query('cursor'),
      limit: limit === undefined ? undefined : Number(limit),
    });

    return query.success
      ? respond(
          context,
          await service.list(
            context.get('ownerId'),
            context.req.param('id'),
            query.data,
          ),
        )
      : invalid(context);
  });
  router.post('/records/:id/messages', async (context) => {
    const body = await jsonBody(context);
    const header = context.req.header('idempotency-key') || undefined;
    const fields = typeof body === 'object' && body !== null ? body : {};
    if (
      header !== undefined &&
      'requestKey' in fields &&
      fields.requestKey !== header
    ) {
      return invalid(context, 'Idempotency-Key');
    }
    const input = recordMessagePostSchema.safeParse(
      header === undefined ? body : { ...fields, requestKey: header },
    );

    return input.success
      ? respond(
          context,
          await service.post(
            context.get('ownerId'),
            context.req.param('id'),
            input.data,
          ),
          202,
        )
      : invalid(context);
  });

  return router;
}
