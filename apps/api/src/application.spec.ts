import { describe, expect, it } from 'vitest';

import {
  createAnalysisService,
  createEditDraftService,
  createEvidenceService,
  createJobService,
  createKnowledgeService,
  createLocationService,
  createMediaService,
  createRecordService,
  createResearchService,
  createSourceService,
  createTranscriptionService,
} from '@antica/application/server';

import { createApplication } from './application.js';

import type { TransactionPort } from '@antica/application/ports';
import type {
  ImageSearchService,
  MediaStoragePort,
} from '@antica/application/server';

import type { ApiAuth, ApplicationParams } from './application.js';
import type { LocalTransfers } from './local-transfers.js';

const transaction: TransactionPort = {
  run: async () => {
    throw new Error('Repository unavailable');
  },
};
const clock = { now: (): string => '2026-10-13T00:00:00.000Z' };
const ids = { create: (): string => 'generated-id' };
const storage: MediaStoragePort = {
  signUpload: async () => {
    throw new Error('Storage unavailable');
  },
  verifyOriginal: async () => {
    throw new Error('Storage unavailable');
  },
  signRead: async () => {
    throw new Error('Storage unavailable');
  },
};
const catalog = {
  resolve: async () => {
    throw new Error('Model catalog unavailable');
  },
};
const selection = {
  analysis: { role: 'analysis', modelId: 'test', profileVersion: '1' },
  transcription: {
    role: 'transcription',
    modelId: 'test',
    profileVersion: '1',
  },
  recordEditing: {
    role: 'recordEditing',
    modelId: 'test',
    profileVersion: '1',
  },
} as const;
const images: ImageSearchService = {
  query: async () => {
    throw new Error('Image index unavailable');
  },
};

describe('fn:createApplication', () => {
  it('should expose readiness with credentials only for a trusted origin', async () => {
    const app = createApplication(
      createParams({
        handle: async () => new Response('auth'),
        ownerId: async () => null,
      }),
    );
    const trusted = await app.request('/healthz', {
      headers: { origin: 'https://collector.example' },
    });
    const foreign = await app.request('/healthz', {
      headers: { origin: 'https://foreign.example' },
    });

    expect(await trusted.json()).toEqual({ status: 'ready' });
    expect(trusted.headers.get('access-control-allow-origin')).toBe(
      'https://collector.example',
    );
    expect(foreign.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('should forward authentication requests to the session transport', async () => {
    const app = createApplication(
      createParams({
        handle: async () =>
          Response.json({ challenge: 'sent' }, { status: 202 }),
        ownerId: async () => null,
      }),
    );
    const response = await app.request('/api/auth/sign-in/phone-number', {
      method: 'POST',
    });

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ challenge: 'sent' });
  });

  it('should reject protected requests without an owner session', async () => {
    const app = createApplication(
      createParams({
        handle: async () => new Response('auth'),
        ownerId: async () => null,
      }),
    );
    const response = await app.request('/v1/jobs/job-1');

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      code: 'AUTH_REQUIRED',
      retryable: false,
      requestId: expect.any(String),
    });
  });

  it('should hide repository failures behind a retryable public error', async () => {
    const app = createApplication(
      createParams({
        handle: async () => new Response('auth'),
        ownerId: async () => 'collector-1',
      }),
    );
    const response = await app.request('/v1/jobs/job-1');

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      code: 'JOB_FAILED',
      retryable: true,
      requestId: expect.any(String),
    });
  });

  it('should normalize malformed JSON before a record command runs', async () => {
    const app = createApplication(
      createParams({
        handle: async () => new Response('auth'),
        ownerId: async () => 'collector-1',
      }),
    );
    const response = await app.request('/v1/records', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{',
    });

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      code: 'VALIDATION_FAILED',
      retryable: false,
      requestId: expect.any(String),
    });
  });

  it('should mount a signed local read outside session authentication', async () => {
    const transfers: LocalTransfers = {
      validateUploadToken: async () => {
        throw new Error('Unexpected upload');
      },
      acceptUploadToken: async () => {
        throw new Error('Unexpected upload');
      },
      openReadToken: async (token) => {
        if (token !== 'signed-read') {
          throw new Error('Invalid signature');
        }

        return {
          bytes: new TextEncoder().encode('private media'),
          mimeType: 'text/plain',
        };
      },
    };
    const app = createApplication(
      createParams(
        {
          handle: async () => new Response('auth'),
          ownerId: async () => {
            throw new Error('Session authentication must not run');
          },
        },
        transfers,
      ),
    );
    const response = await app.request('/v1/storage/reads/signed-read');

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('private media');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
});

function createParams(
  auth: ApiAuth,
  localTransfers?: LocalTransfers,
): ApplicationParams {
  return {
    auth,
    allowedOrigins: ['https://collector.example'],
    localTransfers,
    records: createRecordService(transaction, clock, ids),
    locations: createLocationService(transaction, ids),
    media: createMediaService(transaction, storage, clock, ids),
    evidence: createEvidenceService(transaction, clock, ids),
    analysis: createAnalysisService(
      transaction,
      catalog,
      selection.analysis,
      clock,
      ids,
    ),
    jobs: createJobService(transaction),
    sources: createSourceService(transaction, clock, ids),
    knowledge: createKnowledgeService(transaction, clock, ids),
    research: createResearchService(transaction, clock, ids),
    images,
    transcriptions: createTranscriptionService(
      transaction,
      selection.transcription,
      clock,
      ids,
    ),
    edits: createEditDraftService(
      transaction,
      selection.recordEditing,
      clock,
      ids,
    ),
  };
}
