import { z } from 'zod';

import {
  knowledgeSearchQuerySchema,
  knowledgeTopicsQuerySchema,
  knowledgeTopicTreeQuerySchema,
} from '@antica/contracts';

import { invalid, respond } from '../http.js';

import type { Hono, Context } from 'hono';

import type { KnowledgeService } from '@antica/application/server';

import type { ApiEnv } from '../http.js';
/**
 * mounts bounded static discovery paths before the entry identity route
 * @param router authenticated knowledge router
 * @param knowledge collector service and bulk discovery operations
 */
export function registerKnowledgeSearchRoutes(
  router: Hono<ApiEnv>,
  knowledge: KnowledgeService,
): void {
  router.get('/knowledge/topics', async (context) =>
    browseTopics(context, knowledge),
  );
  router.get('/knowledge/topics/:id/tree', async (context) =>
    topicTree(context, knowledge),
  );
  router.get('/knowledge/search', async (context) =>
    searchKnowledge(context, knowledge),
  );
}

/**
 * validates and serves the /knowledge/topics read
 * @param context authenticated HTTP request
 * @param knowledge owner-scoped discovery service
 * @returns typed API response
 */
async function browseTopics(
  context: Context<ApiEnv>,
  knowledge: KnowledgeService,
): Promise<Response> {
  const input = knowledgeTopicsQuerySchema.safeParse(context.req.query());
  if (!input.success) {
    return invalid(context);
  }
  if (!knowledge.discovery) {
    return discoveryUnavailable(context);
  }

  return respond(
    context,
    await knowledge.discovery.topics(context.get('ownerId'), input.data),
  );
}

/**
 * validates and serves the /knowledge/topics/:id/tree read
 * @param context authenticated HTTP request
 * @param knowledge owner-scoped discovery service
 * @returns typed API response
 */
async function topicTree(
  context: Context<ApiEnv>,
  knowledge: KnowledgeService,
): Promise<Response> {
  const input = knowledgeTopicTreeQuerySchema.safeParse(context.req.query());
  if (!input.success || !z.uuid().safeParse(context.req.param('id')).success) {
    return invalid(context);
  }
  if (!knowledge.discovery) {
    return discoveryUnavailable(context);
  }

  return respond(
    context,
    await knowledge.discovery.tree(
      context.get('ownerId'),
      context.req.param('id')!,
      input.data,
    ),
  );
}

/**
 * validates and serves the /knowledge/search read
 * @param context authenticated HTTP request
 * @param knowledge owner-scoped discovery service
 * @returns typed API response
 */
async function searchKnowledge(
  context: Context<ApiEnv>,
  knowledge: KnowledgeService,
): Promise<Response> {
  const raw = context.req.query();
  let topics: unknown;
  try {
    topics = raw.topics === undefined ? undefined : JSON.parse(raw.topics);
  } catch {
    return invalid(context, 'topics');
  }
  const input = knowledgeSearchQuerySchema.safeParse({
    ...raw,
    topics,
    providers: context.req.queries('providers'),
    languages: context.req.queries('languages'),
    entryTypes: context.req.queries('entryTypes'),
  });
  if (!input.success) {
    return invalid(context);
  }
  if (!knowledge.discovery) {
    return discoveryUnavailable(context);
  }

  return respond(
    context,
    await knowledge.discovery.search(context.get('ownerId'), input.data),
  );
}

/**
 * returns an explicit unavailable capability without a fallback scan
 * @param context authenticated HTTP request
 * @returns stable service-unavailable response
 */
function discoveryUnavailable(context: Context<ApiEnv>): Response {
  return respond(context, {
    success: false,
    error: {
      code: 'INDEX_NOT_READY',
      message: 'Knowledge discovery is unavailable',
      retryable: false,
    },
  });
}
