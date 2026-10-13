import { randomUUID } from 'node:crypto';

import { Hono } from 'hono';

import { cors } from 'hono/cors';

import { RequestBodyError } from './http.js';
import { mountLocalTransfers } from './local-transfers.js';

import { createAnalysisRoutes } from './routes/analysis.js';
import { createEvidenceRoutes } from './routes/evidence.js';
import { createJobRoutes } from './routes/job.js';
import { createKnowledgeRoutes } from './routes/knowledge.js';
import { createLocationRoutes } from './routes/location.js';
import { createMediaRoutes } from './routes/media.js';
import { createRecordRoutes } from './routes/record.js';
import { createResearchRoutes } from './routes/research.js';
import { createVoiceRoutes } from './routes/voice.js';

import type {
  AnalysisService,
  EditDraftService,
  EvidenceService,
  ImageSearchService,
  JobService,
  KnowledgeService,
  LocationService,
  MediaService,
  RecordService,
  ResearchService,
  SourceService,
  TranscriptionService,
} from '@antica/application/server';

import type { ApiEnv } from './http.js';
import type { LocalTransfers } from './local-transfers.js';

const unauthorizedStatus = 401;
const invalidStatus = 422;
const failedStatus = 500;

/** authenticates both native sessions and the Better Auth transport */
export interface ApiAuth {
  handle(request: Request): Promise<Response>;
  ownerId(headers: Headers): Promise<string | null>;
}

/** complete dependencies for the HTTP composition */
export interface ApplicationParams {
  readonly auth: ApiAuth;
  readonly records: RecordService;
  readonly locations: LocationService;
  readonly media: MediaService;
  readonly evidence: EvidenceService;
  readonly analysis: AnalysisService;
  readonly jobs: JobService;
  readonly sources: SourceService;
  readonly knowledge: KnowledgeService;
  readonly research: ResearchService;
  readonly images: ImageSearchService;
  readonly transcriptions: TranscriptionService;
  readonly edits: EditDraftService;
  readonly allowedOrigins: readonly string[];
  readonly localTransfers?: LocalTransfers;
}

/**
 * creates the Hono API without opening sockets or sending work
 * @param params persistent application services and authentication
 * @returns authenticated API router
 */
export function createApplication(params: ApplicationParams): Hono<ApiEnv> {
  const app = new Hono<ApiEnv>();
  app.use(
    '*',
    cors({
      origin: (origin) =>
        params.allowedOrigins.includes(origin) ? origin : '',
      credentials: true,
    }),
  );
  app.get('/healthz', (context) => context.json({ status: 'ready' }));
  app.all('/api/auth/*', async (context) =>
    params.auth.handle(context.req.raw),
  );
  if (params.localTransfers) {
    mountLocalTransfers(app, params.localTransfers);
  }
  app.use('/v1/*', async (context, next) => {
    const ownerId = await params.auth.ownerId(context.req.raw.headers);
    if (!ownerId) {
      return context.json(
        {
          code: 'AUTH_REQUIRED',
          message: 'Sign in required',
          retryable: false,
          requestId: randomUUID(),
        },
        unauthorizedStatus,
      );
    }
    context.set('ownerId', ownerId);

    return next();
  });

  app.route('/v1/records', createRecordRoutes(params.records));
  app.route('/v1/locations', createLocationRoutes(params.locations));
  app.route('/v1/media', createMediaRoutes(params.media));
  app.route('/v1', createEvidenceRoutes(params.evidence));
  app.route('/v1', createAnalysisRoutes(params.analysis));
  app.route('/v1', createJobRoutes(params.jobs));
  app.route('/v1', createKnowledgeRoutes(params.sources, params.knowledge));
  app.route('/v1', createResearchRoutes(params.research, params.images));
  app.route('/v1', createVoiceRoutes(params.transcriptions, params.edits));
  mountErrors(app);

  return app;
}

/**
 * normalizes request and internal errors without exposing provider details
 * @param app application router
 */
function mountErrors(app: Hono<ApiEnv>): void {
  app.onError((error, context) => {
    if (error instanceof RequestBodyError || error instanceof SyntaxError) {
      return context.json(
        {
          code: 'VALIDATION_FAILED',
          message: 'Invalid JSON request',
          retryable: false,
          requestId: randomUUID(),
        },
        invalidStatus,
      );
    }

    return context.json(
      {
        code: 'JOB_FAILED',
        message: 'Service request failed',
        retryable: true,
        requestId: randomUUID(),
      },
      failedStatus,
    );
  });
}
