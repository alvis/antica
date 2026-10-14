import { Hono } from 'hono';
import { z } from 'zod';

import {
  imageQuerySchema,
  noteInputSchema,
  referenceInputSchema,
  researchRequestSchema,
} from '@antica/contracts';

import { invalid, jsonBody, respond } from '../http.js';

import type {
  ImageSearchService,
  ResearchService,
} from '@antica/application/server';

import type { ApiEnv } from '../http.js';

const maximumPageSize = 100;
const acceptedStatus = 202;
const createdStatus = 201;
const referenceQuerySchema = z.strictObject({
  checkId: z.uuid().optional(),
  observationId: z.uuid().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(maximumPageSize).optional(),
});

/**
 * registers explicit research, note, image search, and saved reference routes
 * @param research persistent research service
 * @param images owner-scoped visual retrieval service
 * @returns authenticated Hono routes
 */
export function createResearchRoutes(
  research: ResearchService,
  images: ImageSearchService,
): Hono<ApiEnv> {
  const router = new Hono<ApiEnv>();
  registerResearchRoutes(router, research, images);
  registerReferenceRoutes(router, research);

  return router;
}

/**
 * mounts visual search and explicit research operations
 * @param router API router receiving the endpoints
 * @param research persistent research operations
 * @param images owner-scoped visual retrieval operations
 */
function registerResearchRoutes(
  router: Hono<ApiEnv>,
  research: ResearchService,
  images: ImageSearchService,
): void {
  router.post('/search/images', async (context) => {
    const input = imageQuerySchema.safeParse(await jsonBody(context));
    if (!input.success) {
      return invalid(context);
    }

    return respond(
      context,
      await images.query(context.get('ownerId'), input.data),
    );
  });
  router.post('/research', async (context) => {
    const input = researchRequestSchema.safeParse(await jsonBody(context));
    if (!input.success) {
      return invalid(context);
    }

    return respond(
      context,
      await research.submit(context.get('ownerId'), input.data),
      acceptedStatus,
    );
  });
  router.get('/research/:id', async (context) =>
    respond(
      context,
      await research.get(context.get('ownerId'), context.req.param('id')),
    ),
  );
}

/**
 * mounts saved notes and reference adoption operations
 * @param router API router receiving the endpoints
 * @param research persistent research operations
 */
function registerReferenceRoutes(
  router: Hono<ApiEnv>,
  research: ResearchService,
): void {
  router.post('/notes', async (context) => {
    const input = noteInputSchema.safeParse(await jsonBody(context));
    if (!input.success) {
      return invalid(context);
    }

    return respond(
      context,
      await research.saveNote(context.get('ownerId'), input.data),
      createdStatus,
    );
  });
  router.post('/references', async (context) => {
    const input = referenceInputSchema.safeParse(await jsonBody(context));
    if (!input.success) {
      return invalid(context);
    }

    return respond(
      context,
      await research.addReference(context.get('ownerId'), input.data),
      createdStatus,
    );
  });
  router.get('/records/:id/references', async (context) => {
    const query = referenceQuerySchema.safeParse(context.req.query());
    if (!query.success) {
      return invalid(context);
    }

    return respond(
      context,
      await research.listReferences(
        context.get('ownerId'),
        context.req.param('id'),
        query.data,
      ),
    );
  });
}
