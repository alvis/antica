import { describe, expect, it, vi } from 'vitest';

import { ensureCollectorUser } from '@antica/platform';

import { localConfig } from './fixtures/runtime.js';
import { createPersistence } from './persistence.js';

vi.mock('@antica/platform', async (importOriginal) => {
  const original = await importOriginal<typeof import('@antica/platform')>();

  return {
    ...original,
    ensureCollectorUser: vi.fn(async () => original.collectorUserId),
  } satisfies typeof original;
});

describe('fn:createPersistence', () => {
  it('should open a local signed store with trimmed trusted origins', async () => {
    const persistence = await createPersistence(localConfig);

    try {
      expect(persistence.trustedOrigins).toEqual([
        'antica://',
        'https://collector.example',
      ]);
      expect(persistence.local).toBeDefined();
      const signed = await persistence.storage.signRead('originals/object-1');
      expect(new URL(signed.url).origin).toBe('http://127.0.0.1:8080');
      expect(persistence.ids.create()).not.toBe(persistence.ids.create());
      expect(Number.isNaN(Date.parse(persistence.clock.now()))).toBe(false);
    } finally {
      await persistence.database.close();
    }
  });

  it('should select a cloud store and sign reads through its public endpoint', async () => {
    const persistence = await createPersistence({
      ...localConfig,
      ANTICA_STORAGE_DRIVER: 's3',
      ANTICA_S3_BUCKET: 'collector-media',
      ANTICA_S3_ENDPOINT: 'http://127.0.0.1:9000',
      ANTICA_S3_PUBLIC_ENDPOINT: 'https://media.example',
      AWS_ACCESS_KEY_ID: 'test-access-key',
      AWS_SECRET_ACCESS_KEY: 'test-secret-key',
    });

    try {
      expect(persistence.local).toBeUndefined();
      const signed = await persistence.storage.signRead('originals/object-1');
      expect(new URL(signed.url).origin).toBe('https://media.example');
    } finally {
      await persistence.database.close();
    }
  });

  it('should omit local transfer capability for a cloud store without explicit credentials', async () => {
    const persistence = await createPersistence({
      NODE_ENV: 'production',
      PORT: 8080,
      HOST: '127.0.0.1',
      DATABASE_URL: localConfig.DATABASE_URL,
      BETTER_AUTH_URL: 'https://collector.example',
      BETTER_AUTH_SECRET: localConfig.BETTER_AUTH_SECRET,
      ANTICA_COLLECTOR_PHONE: localConfig.ANTICA_COLLECTOR_PHONE,
      ANTICA_ALLOWED_ORIGINS: 'https://collector.example',
      ANTICA_OTP_DRIVER: 'whatsapp',
      WHATSAPP_TOKEN: 'test-token',
      WHATSAPP_PHONE_NUMBER_ID: 'test-number',
      WHATSAPP_TEMPLATE_NAME: 'test-template',
      ANTICA_STORAGE_DRIVER: 's3',
      ANTICA_S3_BUCKET: 'collector-media',
      ANTICA_S3_REGION: 'us-east-1',
    });

    try {
      expect(persistence.local).toBeUndefined();
      expect(persistence.trustedOrigins).toEqual(['https://collector.example']);
    } finally {
      await persistence.database.close();
    }
  });

  it('should propagate a collector setup failure', async () => {
    vi.mocked(ensureCollectorUser).mockRejectedValueOnce(
      new Error('Collector setup unavailable'),
    );

    await expect(createPersistence(localConfig)).rejects.toEqual(
      new Error('Collector setup unavailable'),
    );
  });
});
