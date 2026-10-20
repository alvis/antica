import { entityIdSchema, relatedKnowledgeQuerySchema } from '@antica/contracts';

import { invalid, respond } from '../http.js';

import type { Hono } from 'hono';

import type { KnowledgeService } from '@antica/application/server';
import type { RelatedKnowledgeDiscovery } from '@antica/contracts';

import type { ApiEnv } from '../http.js';

/** optional contextual capability on the existing bulk discovery service */
export type RelatedKnowledgeService = KnowledgeService & {
  readonly discovery?: KnowledgeService['discovery'] &
    Partial<RelatedKnowledgeDiscovery>;
};

/**
 * registers an isolated record-related read without touching record commands
 * @param router authenticated knowledge router
 * @param knowledge saved discovery capabilities
 */
export function registerRelatedKnowledgeRoute(
  router: Hono<ApiEnv>,
  knowledge: RelatedKnowledgeService,
): void {
  router.get('/records/:id/related-knowledge', async (context) => {
    const id = entityIdSchema.safeParse(context.req.param('id'));
    const input = relatedKnowledgeQuerySchema.safeParse(context.req.query());
    if (!id.success || !input.success) {
      return invalid(context);
    }
    if (!knowledge.discovery?.related) {
      return respond(context, {
        success: false,
        error: {
          code: 'SOURCE_UNAVAILABLE',
          message: 'Related knowledge is unavailable',
          retryable: true,
        },
      });
    }
    const snapshot = await knowledge.discovery.related(
      context.get('ownerId'),
      id.data,
      input.data,
    );
    if (!snapshot) {
      return respond(context, {
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Record not found',
          retryable: false,
        },
      });
    }
    if (
      input.data.recordRevision !== undefined &&
      input.data.recordRevision !== snapshot.recordRevision
    ) {
      return respond(context, {
        success: false,
        error: {
          code: 'REVISION_CONFLICT',
          message: 'Record changed since it was opened',
          retryable: false,
        },
      });
    }

    return respond(context, { success: true, data: snapshot });
  });
}
