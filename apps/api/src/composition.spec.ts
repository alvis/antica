import { createHmac } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import {
  composeApplication,
  readApplicationConfig,
  readImageConfiguration,
} from './composition.js';
import { createLocalSettings } from './fixtures/runtime.js';

vi.mock('@antica/platform', async (importOriginal) => {
  const original = await importOriginal<typeof import('@antica/platform')>();

  return {
    ...original,
    ensureCollectorUser: vi.fn(async () => original.collectorUserId),
  } satisfies typeof original;
});

const development = {
  DATABASE_URL: 'postgresql://acceptance@localhost/unused',
  BETTER_AUTH_URL: 'http://localhost:8080',
  BETTER_AUTH_SECRET: 'acceptance-secret-at-least-32-characters',
  ANTICA_COLLECTOR_PHONE: '+447700900123',
  ANTICA_OTP_DRIVER: 'development',
  ANTICA_DEV_OTP_INBOX: '/nonexistent/antica-inbox',
  ANTICA_STORAGE_DRIVER: 'local',
  ANTICA_STORAGE_LOCAL_ROOT: '/nonexistent/antica-storage',
  ANTICA_STORAGE_SIGNING_SECRET:
    'acceptance-storage-secret-at-least-32-characters',
};

describe('fn:readImageConfiguration', () => {
  it('should disable unspecified retrieval and prohibit local retrieval in production', () => {
    expect(readImageConfiguration({})).toMatchObject({
      success: true,
      data: { ANTICA_IMAGE_SEARCH_DRIVER: 'disabled' },
    });
    expect(readImageConfiguration({ NODE_ENV: 'production' })).toMatchObject({
      success: true,
      data: { ANTICA_IMAGE_SEARCH_DRIVER: 'disabled' },
    });
    expect(
      readImageConfiguration({ ANTICA_IMAGE_SEARCH_DRIVER: 'local' }),
    ).toMatchObject({ success: true });
    expect(
      readImageConfiguration({
        ANTICA_IMAGE_SEARCH_DRIVER: 'local',
        NODE_ENV: 'production',
      }),
    ).toMatchObject({
      success: false,
      error: { code: 'PROVIDER_UNAVAILABLE' },
    });
  });

  it('should require a complete compatible cloud manifest without exposing the provider secret', () => {
    const cloud = {
      ANTICA_IMAGE_SEARCH_DRIVER: 'voyage-qdrant',
      VOYAGE_API_KEY: 'private-voyage-secret',
      QDRANT_URL: 'https://qdrant.example.org',
      QDRANT_COLLECTION: 'acceptance',
      IMAGE_EMBEDDING_MODEL_ID: 'voyage-multimodal-3',
      IMAGE_EMBEDDING_DIMENSIONS: '1024',
      IMAGE_INDEX_VERSION: '1',
      IMAGE_CORPUS_ID: 'catalog',
    };
    expect(readImageConfiguration(cloud)).toMatchObject({ success: true });
    const rejected = readImageConfiguration({
      ...cloud,
      IMAGE_EMBEDDING_DIMENSIONS: '512',
    });
    expect(rejected).toMatchObject({ success: false });
    expect(JSON.stringify(rejected)).not.toContain(cloud.VOYAGE_API_KEY);
    expect(
      readImageConfiguration({ ...cloud, QDRANT_COLLECTION: undefined }),
    ).toMatchObject({ success: false });
  });
});

describe('fn:readApplicationConfig', () => {
  it('should accept complete development settings without connecting to the configured database', () => {
    expect(readApplicationConfig(development)).toMatchObject({
      success: true,
      data: { PORT: 8080, NODE_ENV: 'development' },
    });
  });

  it.each([
    { DATABASE_URL: undefined },
    { BETTER_AUTH_SECRET: 'short-secret' },
    { ANTICA_COLLECTOR_PHONE: '07700900123' },
    { ANTICA_DEV_OTP_INBOX: undefined },
    { ANTICA_STORAGE_SIGNING_SECRET: undefined },
    { ANTICA_OTP_DRIVER: 'whatsapp' },
    { ANTICA_STORAGE_DRIVER: 's3' },
    { AWS_ACCESS_KEY_ID: 'partial-key' },
    { NODE_ENV: 'production' },
  ])(
    'should reject unusable selected adapters before startup: %j',
    (override) => {
      const result = readApplicationConfig({ ...development, ...override });
      expect(result).toMatchObject({
        success: false,
        error: { code: 'VALIDATION_FAILED', retryable: false },
      });
      expect(JSON.stringify(result)).not.toContain(
        development.BETTER_AUTH_SECRET,
      );
      expect(JSON.stringify(result)).not.toContain(
        development.ANTICA_STORAGE_SIGNING_SECRET,
      );
    },
  );

  it('should accept production WhatsApp and S3 settings then reject an insecure auth origin', () => {
    const production = {
      ...development,
      NODE_ENV: 'production',
      ANTICA_OTP_DRIVER: 'whatsapp',
      WHATSAPP_TOKEN: 'test-token',
      WHATSAPP_PHONE_NUMBER_ID: 'test-number-id',
      WHATSAPP_TEMPLATE_NAME: 'test-template',
      ANTICA_STORAGE_DRIVER: 's3',
      ANTICA_S3_BUCKET: 'acceptance-bucket',
      BETTER_AUTH_URL: 'https://antica.example.org',
    };
    expect(readApplicationConfig(production)).toMatchObject({ success: true });
    expect(
      readApplicationConfig({
        ...production,
        BETTER_AUTH_URL: 'http://antica.example.org',
      }),
    ).toMatchObject({ success: false });
  });
});

describe('fn:composeApplication', () => {
  it('should assemble a closable persistent API with owner-protected routes', async () => {
    const runtime = await composeApplication(createLocalSettings());

    try {
      const health = await runtime.app.request('/healthz');
      const protectedResponse = await runtime.app.request('/v1/jobs/job-1');

      expect(await health.json()).toEqual({ status: 'ready' });
      expect(protectedResponse.status).toBe(401);
      expect(await protectedResponse.json()).toMatchObject({
        code: 'AUTH_REQUIRED',
        retryable: false,
      });
      const invalidUpload = await runtime.app.request(
        '/v1/storage/uploads/invalid-token',
        { method: 'PUT', body: 'bytes' },
      );
      expect(invalidUpload.status).toBe(403);
      expect(await invalidUpload.json()).toMatchObject({
        code: 'UPLOAD_INCOMPLETE',
      });
    } finally {
      await runtime.close();
    }
  });

  it('should mount the configured webhook and reject an unsigned event', async () => {
    const settings = createLocalSettings();
    const runtime = await composeApplication({
      ...settings,
      knowledge: {
        ...settings.knowledge,
        webhook: {
          url: 'https://collector.example/webhooks/llama-parse',
          signingSecret: 'acceptance-webhook-signing-secret',
        },
      },
    });

    try {
      const response = await runtime.app.request('/webhooks/llama-parse', {
        method: 'POST',
        body: '{}',
      });
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({
        error: 'Invalid webhook signature',
      });

      const body = JSON.stringify({
        event_id: 'event-1',
        event_type: 'job.completed',
        timestamp: 0,
        data: { job_id: 'provider-job-1' },
      });
      const signature = createHmac(
        'sha256',
        'acceptance-webhook-signing-secret',
      )
        .update(body)
        .digest('hex');
      const expired = await runtime.app.request('/webhooks/llama-parse', {
        method: 'POST',
        headers: { 'LC-Signature': `sha256=${signature}` },
        body,
      });
      expect(expired.status).toBe(401);
      expect(await expired.json()).toEqual({ error: 'Expired webhook event' });
    } finally {
      await runtime.close();
    }
  });

  it('should reject incompatible image startup after persistence is created', async () => {
    const settings = createLocalSettings();
    await expect(
      composeApplication({
        ...settings,
        app: { ...settings.app, NODE_ENV: 'production' },
      }),
    ).rejects.toThrow();
  });

  it('should omit local transfer routes when configured for cloud storage', async () => {
    const settings = createLocalSettings();
    const runtime = await composeApplication({
      ...settings,
      app: {
        ...settings.app,
        ANTICA_STORAGE_DRIVER: 's3',
        ANTICA_S3_BUCKET: 'collector-media',
        ANTICA_S3_ENDPOINT: 'http://127.0.0.1:9000',
        AWS_ACCESS_KEY_ID: 'test-access-key',
        AWS_SECRET_ACCESS_KEY: 'test-secret-key',
      },
    });

    try {
      const response = await runtime.app.request(
        '/v1/storage/uploads/invalid-token',
        { method: 'PUT', body: 'bytes' },
      );
      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({ code: 'AUTH_REQUIRED' });
    } finally {
      await runtime.close();
    }
  });
});
