import { Hono } from 'hono';

import {
  editDraftApplySchema,
  editDraftRequestSchema,
  transcriptionConfirmSchema,
  transcriptionSubmitSchema,
} from '@antica/contracts';

import { invalid, jsonBody, respond } from '../http.js';

import type {
  EditDraftService,
  TranscriptionService,
} from '@antica/application/server';

import type { ApiEnv } from '../http.js';

/**
 * creates collector-controlled voice transcription and selective record editing routes
 * @param transcriptions owner-scoped transcription operations
 * @param edits selective record edit operations
 * @returns authenticated Hono routes for transcription and record edits
 */
export function createVoiceRoutes(
  transcriptions: TranscriptionService,
  edits: EditDraftService,
): Hono<ApiEnv> {
  const router = new Hono<ApiEnv>();
  router.post('/transcriptions', async (context) => {
    const input = transcriptionSubmitSchema.safeParse(await jsonBody(context));

    return input.success
      ? respond(
          context,
          await transcriptions.submit(context.get('ownerId'), input.data),
          202,
        )
      : invalid(context);
  });
  router.get('/transcriptions/:id', async (context) =>
    respond(
      context,
      await transcriptions.get(context.get('ownerId'), context.req.param('id')),
    ),
  );
  router.post('/transcriptions/:id/confirm', async (context) => {
    const input = transcriptionConfirmSchema.safeParse(await jsonBody(context));

    return input.success
      ? respond(
          context,
          await transcriptions.confirm(
            context.get('ownerId'),
            context.req.param('id'),
            input.data,
          ),
        )
      : invalid(context);
  });
  router.post('/edit-drafts', async (context) => {
    const input = editDraftRequestSchema.safeParse(await jsonBody(context));

    return input.success
      ? respond(
          context,
          await edits.submit(context.get('ownerId'), input.data),
          202,
        )
      : invalid(context);
  });
  router.get('/edit-drafts/:id', async (context) =>
    respond(
      context,
      await edits.get(context.get('ownerId'), context.req.param('id')),
    ),
  );
  router.post('/edit-drafts/:id/apply', async (context) => {
    const input = editDraftApplySchema.safeParse(await jsonBody(context));

    return input.success
      ? respond(
          context,
          await edits.apply(
            context.get('ownerId'),
            context.req.param('id'),
            input.data,
          ),
        )
      : invalid(context);
  });

  return router;
}
