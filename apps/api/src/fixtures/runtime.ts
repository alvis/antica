import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { readKnowledgeConfiguration } from '@antica/platform';
import { createConfiguredModels } from '@antica/platform/ai';

import type {
  ApplicationConfig,
  ApplicationSettings,
} from '../configuration.js';

export const localConfig: ApplicationConfig = {
  NODE_ENV: 'development',
  PORT: 8080,
  HOST: '127.0.0.1',
  DATABASE_URL:
    'postgresql://acceptance@127.0.0.1:54329/antica_riley_api_tests',
  BETTER_AUTH_URL: 'http://127.0.0.1:8080',
  BETTER_AUTH_SECRET: 'acceptance-secret-at-least-32-characters',
  ANTICA_COLLECTOR_PHONE: '+447700900123',
  ANTICA_ALLOWED_ORIGINS: 'antica://, https://collector.example, ,',
  ANTICA_OTP_DRIVER: 'development',
  ANTICA_DEV_OTP_INBOX: join(tmpdir(), 'antica-riley-api-tests/otp/inbox'),
  ANTICA_STORAGE_DRIVER: 'local',
  ANTICA_STORAGE_LOCAL_ROOT: join(tmpdir(), 'antica-riley-api-tests/objects'),
  ANTICA_STORAGE_SIGNING_SECRET:
    'acceptance-storage-secret-at-least-32-characters',
  ANTICA_S3_REGION: 'us-east-1',
};

/**
 * creates a validated, listener-independent local API configuration for tests
 * @returns configured local API dependencies
 */
export function createLocalSettings(): ApplicationSettings {
  const modelConfig = { driver: 'development', production: false } as const;
  const models = createConfiguredModels(modelConfig);
  const knowledge = readKnowledgeConfiguration({
    ANTICA_PARSING_DRIVER: 'local',
    ANTICA_TEXT_SEARCH_DRIVER: 'local',
  });
  if (!models.success || !knowledge.success) {
    throw new Error('Runtime test configuration is invalid');
  }

  return {
    app: localConfig,
    models: models.data,
    modelConfig,
    image: { ANTICA_IMAGE_SEARCH_DRIVER: 'local' },
    knowledge: knowledge.data,
  };
}
