import { describe, expect, it, vi } from 'vitest';

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
import type { PublicError } from '@antica/contracts';

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

  it('should correlate a redacted failure with sanitized server diagnostics', async () => {
    const secret = 'private-provider-token-and-collector-notes';
    const cause = new Error(secret);
    cause.name = secret;
    cause.stack = `Error: ${secret}\n    at provider (/private/${secret}/packages/platform/src/cloud.ts:56:78)`;
    const failure = new TypeError(secret, { cause });
    failure.stack = `TypeError: ${secret}\n    at authenticate (/private/${secret}/apps/api/src/auth.ts:12:34)`;
    const write = vi.fn<typeof process.stderr.write>(() => true);
    vi.spyOn(process.stderr, 'write').mockImplementation(write);
    const app = createApplication(
      createParams({
        handle: async () => {
          throw failure;
        },
        ownerId: async () => null,
      }),
    );

    const response = await app.fetch(
      new Request(`https://api.example/api/auth/session?token=${secret}`, {
        method: 'POST',
        headers: {
          'authorization': `Bearer ${secret}`,
          'cookie': `session=${secret}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ notes: secret }),
      }),
    );
    const body: PublicError = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({
      code: 'JOB_FAILED',
      message: 'Service request failed',
      retryable: true,
      requestId: expect.stringMatching(
        /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/,
      ),
    });
    expect(
      write.mock.calls.map(([entry]) => JSON.parse(String(entry))),
    ).toEqual([
      {
        event: 'api.request_failed',
        requestId: body.requestId,
        status: 500,
        errorType: 'TypeError',
        sourceFrame: 'apps/api/src/auth.ts:12:34',
        stackFingerprint: '2dfc8aec94ba7e3e',
        causes: [
          {
            errorType: 'Error',
            sourceFrame: 'packages/platform/src/cloud.ts:56:78',
            stackFingerprint: 'ca2e48b5cfff72ba',
          },
        ],
      },
    ]);
    expect(
      JSON.stringify({ body, diagnostics: write.mock.calls }),
    ).not.toContain(secret);
  });

  it('should identify range failures without exposing external stack paths', async () => {
    const failure = new RangeError('private-provider-limit');
    failure.stack =
      'RangeError: private-provider-limit\n    at query (/private/provider-secret/sdk.js:56:78)';
    const write = vi.fn<typeof process.stderr.write>(() => true);
    vi.spyOn(process.stderr, 'write').mockImplementation(write);
    const app = createApplication(
      createParams({
        handle: async () => {
          throw failure;
        },
        ownerId: async () => null,
      }),
    );

    const response = await app.fetch(
      new Request('https://api.example/api/auth/session'),
    );
    const body: PublicError = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({
      code: 'JOB_FAILED',
      message: 'Service request failed',
      retryable: true,
      requestId: expect.any(String),
    });
    expect(
      write.mock.calls.map(([entry]) => JSON.parse(String(entry))),
    ).toEqual([
      {
        event: 'api.request_failed',
        requestId: body.requestId,
        status: 500,
        errorType: 'RangeError',
        sourceFrame: null,
        stackFingerprint: expect.stringMatching(/^[\da-f]{16}$/),
        causes: [],
      },
    ]);
  });

  it('should retain a correlated diagnostic when an unexpected error has no stack', async () => {
    const failure = new Error('private-upstream-response');
    delete failure.stack;
    const write = vi.fn<typeof process.stderr.write>(() => true);
    vi.spyOn(process.stderr, 'write').mockImplementation(write);
    const app = createApplication(
      createParams({
        handle: async () => {
          throw failure;
        },
        ownerId: async () => null,
      }),
    );

    const response = await app.fetch(
      new Request('https://api.example/api/auth/session'),
    );
    const body: PublicError = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({
      code: 'JOB_FAILED',
      message: 'Service request failed',
      retryable: true,
      requestId: expect.any(String),
    });
    expect(
      write.mock.calls.map(([entry]) => JSON.parse(String(entry))),
    ).toEqual([
      {
        event: 'api.request_failed',
        requestId: body.requestId,
        status: 500,
        errorType: 'Error',
        sourceFrame: null,
        stackFingerprint: null,
        causes: [],
      },
    ]);
  });

  it('should retain a non-error cause without serializing its provider payload', async () => {
    const secret = 'private-provider-payload';
    const cause = {
      name: 'TypeError',
      stack: `/private/${secret}/provider.js:1:2`,
      providerToken: secret,
    };
    const failure = new Error(secret, { cause });
    delete failure.stack;
    const write = vi.fn<typeof process.stderr.write>(() => true);
    vi.spyOn(process.stderr, 'write').mockImplementation(write);
    const app = createApplication(
      createParams({
        handle: async () => {
          throw failure;
        },
        ownerId: async () => null,
      }),
    );

    const response = await app.fetch(
      new Request('https://api.example/api/auth/session'),
    );
    const body: PublicError = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({
      code: 'JOB_FAILED',
      message: 'Service request failed',
      retryable: true,
      requestId: expect.any(String),
    });
    expect(
      write.mock.calls.map(([entry]) => JSON.parse(String(entry))),
    ).toEqual([
      {
        event: 'api.request_failed',
        requestId: body.requestId,
        status: 500,
        errorType: 'Error',
        sourceFrame: null,
        stackFingerprint: null,
        causes: [
          { errorType: 'NonError', sourceFrame: null, stackFingerprint: null },
        ],
      },
    ]);
    expect(
      JSON.stringify({ body, diagnostics: write.mock.calls }),
    ).not.toContain(secret);
  });

  it('should stop a cyclic cause chain without repeating the outer failure', async () => {
    const secret = 'private-cyclic-provider-response';
    const failure = new Error(secret);
    const cause = new TypeError(secret, { cause: failure });
    failure.cause = cause;
    delete failure.stack;
    delete cause.stack;
    const write = vi.fn<typeof process.stderr.write>(() => true);
    vi.spyOn(process.stderr, 'write').mockImplementation(write);
    const app = createApplication(
      createParams({
        handle: async () => {
          throw failure;
        },
        ownerId: async () => null,
      }),
    );

    const response = await app.fetch(
      new Request('https://api.example/api/auth/session'),
    );
    const body: PublicError = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({
      code: 'JOB_FAILED',
      message: 'Service request failed',
      retryable: true,
      requestId: expect.any(String),
    });
    expect(
      write.mock.calls.map(([entry]) => JSON.parse(String(entry))),
    ).toEqual([
      {
        event: 'api.request_failed',
        requestId: body.requestId,
        status: 500,
        errorType: 'Error',
        sourceFrame: null,
        stackFingerprint: null,
        causes: [
          { errorType: 'TypeError', sourceFrame: null, stackFingerprint: null },
        ],
      },
    ]);
    expect(
      JSON.stringify({ body, diagnostics: write.mock.calls }),
    ).not.toContain(secret);
  });

  it('should bound diagnostics to the first three sanitized causes', async () => {
    const secret = 'private-deep-provider-response';
    const fourth = new Error(secret);
    const third = new RangeError(secret, { cause: fourth });
    const second = new SyntaxError(secret, { cause: third });
    const first = new TypeError(secret, { cause: second });
    const failure = new Error(secret, { cause: first });
    for (const error of [failure, first, second, third, fourth]) {
      delete error.stack;
    }
    const write = vi.fn<typeof process.stderr.write>(() => true);
    vi.spyOn(process.stderr, 'write').mockImplementation(write);
    const app = createApplication(
      createParams({
        handle: async () => {
          throw failure;
        },
        ownerId: async () => null,
      }),
    );

    const response = await app.fetch(
      new Request('https://api.example/api/auth/session'),
    );
    const body: PublicError = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({
      code: 'JOB_FAILED',
      message: 'Service request failed',
      retryable: true,
      requestId: expect.any(String),
    });
    expect(
      write.mock.calls.map(([entry]) => JSON.parse(String(entry))),
    ).toEqual([
      {
        event: 'api.request_failed',
        requestId: body.requestId,
        status: 500,
        errorType: 'Error',
        sourceFrame: null,
        stackFingerprint: null,
        causes: [
          { errorType: 'TypeError', sourceFrame: null, stackFingerprint: null },
          {
            errorType: 'SyntaxError',
            sourceFrame: null,
            stackFingerprint: null,
          },
          {
            errorType: 'RangeError',
            sourceFrame: null,
            stackFingerprint: null,
          },
        ],
      },
    ]);
    expect(
      JSON.stringify({ body, diagnostics: write.mock.calls }),
    ).not.toContain(secret);
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
    sources: createSourceService({
      transaction,
      clock,
      ids,
    }),
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
