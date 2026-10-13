import { z } from 'zod';

import type { OperationResult } from '@antica/application/ports';
import type { KnowledgeConfiguration } from '@antica/platform';
import type { ConfiguredModels, ModelConfiguration } from '@antica/platform/ai';

const IMAGE_DIMENSIONS = 1024;
const MAX_PORT = 65535;
const DEFAULT_PORT = 8080;
const MIN_SECRET_LENGTH = 32;

/** groups validated server settings without exposing provider credentials to clients */
export interface ApplicationSettings {
  readonly app: ApplicationConfig;
  readonly models: ConfiguredModels;
  readonly modelConfig: ModelConfiguration;
  readonly image: ImageConfiguration;
  readonly knowledge: KnowledgeConfiguration;
}

const imageConfigurationSchema = z
  .object({
    ANTICA_IMAGE_SEARCH_DRIVER: z.enum(['local', 'voyage-qdrant']),
    VOYAGE_API_KEY: z.string().min(1).optional(),
    QDRANT_URL: z.url().optional(),
    QDRANT_API_KEY: z.string().min(1).optional(),
    QDRANT_COLLECTION: z.string().min(1).optional(),
    IMAGE_EMBEDDING_MODEL_ID: z
      .enum(['voyage-multimodal-3', 'voyage-multimodal-3.5'])
      .optional(),
    IMAGE_EMBEDDING_DIMENSIONS: z.coerce.number().int().positive().optional(),
    IMAGE_INDEX_VERSION: z.string().min(1).optional(),
    IMAGE_CORPUS_ID: z.string().min(1).optional(),
  })
  .superRefine((value, context) => {
    if (value.ANTICA_IMAGE_SEARCH_DRIVER === 'voyage-qdrant') {
      for (const key of [
        'VOYAGE_API_KEY',
        'QDRANT_URL',
        'QDRANT_COLLECTION',
        'IMAGE_EMBEDDING_MODEL_ID',
        'IMAGE_EMBEDDING_DIMENSIONS',
        'IMAGE_INDEX_VERSION',
        'IMAGE_CORPUS_ID',
      ] as const) {
        if (!value[key]) {
          context.addIssue({
            code: 'custom',
            path: [key],
            message: 'Required for cloud image retrieval',
          });
        }
      }
      if (value.IMAGE_EMBEDDING_DIMENSIONS !== IMAGE_DIMENSIONS) {
        context.addIssue({
          code: 'custom',
          path: ['IMAGE_EMBEDDING_DIMENSIONS'],
          message: 'Supported image models require 1024 dimensions',
        });
      }
    }
  });

/** validated image-provider environment independent of inference configuration */
export type ImageConfiguration = z.infer<typeof imageConfigurationSchema>;

/**
 * validates an explicit image-search driver without exposing credentials
 * @param env explicit server environment settings
 * @returns validated configuration or a redacted startup failure
 */
export function readImageConfiguration(
  env: Readonly<Record<string, string | undefined>>,
): OperationResult<ImageConfiguration> {
  const result = imageConfigurationSchema.safeParse(env);
  if (!result.success) {
    return {
      success: false,
      error: {
        code: 'VALIDATION_FAILED',
        message: `Invalid image configuration: ${[...new Set(result.error.issues.map((issue) => issue.path.join('.')))].join(', ')}`,
        retryable: false,
      },
    };
  }
  if (
    env.NODE_ENV === 'production' &&
    result.data.ANTICA_IMAGE_SEARCH_DRIVER === 'local'
  ) {
    return {
      success: false,
      error: {
        code: 'PROVIDER_UNAVAILABLE',
        message: 'Local image retrieval is forbidden in production',
        retryable: false,
      },
    };
  }

  return { success: true, data: result.data };
}

const environmentSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    PORT: z.coerce.number().int().min(1).max(MAX_PORT).default(DEFAULT_PORT),
    HOST: z.string().min(1).default('0.0.0.0'),
    DATABASE_URL: z.url(),
    BETTER_AUTH_URL: z.url(),
    BETTER_AUTH_SECRET: z.string().min(MIN_SECRET_LENGTH),
    ANTICA_COLLECTOR_PHONE: z.string().regex(/^\+[1-9]\d{1,14}$/),
    ANTICA_ALLOWED_ORIGINS: z.string().default('antica://'),
    ANTICA_OTP_DRIVER: z.enum(['development', 'whatsapp']),
    ANTICA_DEV_OTP_INBOX: z.string().min(1).optional(),
    WHATSAPP_TOKEN: z.string().min(1).optional(),
    WHATSAPP_PHONE_NUMBER_ID: z.string().min(1).optional(),
    WHATSAPP_TEMPLATE_NAME: z.string().min(1).optional(),
    ANTICA_STORAGE_DRIVER: z.enum(['local', 's3']),
    ANTICA_STORAGE_LOCAL_ROOT: z.string().min(1).optional(),
    ANTICA_STORAGE_SIGNING_SECRET: z.string().min(MIN_SECRET_LENGTH).optional(),
    ANTICA_S3_BUCKET: z.string().min(1).optional(),
    ANTICA_S3_REGION: z.string().min(1).default('us-east-1'),
    ANTICA_S3_ENDPOINT: z.url().optional(),
    ANTICA_S3_PUBLIC_ENDPOINT: z.url().optional(),
    AWS_ACCESS_KEY_ID: z.string().min(1).optional(),
    AWS_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  })
  .superRefine((value, context) => {
    const requireValue = (key: keyof typeof value): void => {
      if (!value[key]) {
        context.addIssue({
          code: 'custom',
          path: [key],
          message: 'Required for selected adapter',
        });
      }
    };
    if (value.ANTICA_OTP_DRIVER === 'development') {
      requireValue('ANTICA_DEV_OTP_INBOX');
    } else {
      requireValue('WHATSAPP_TOKEN');
      requireValue('WHATSAPP_PHONE_NUMBER_ID');
      requireValue('WHATSAPP_TEMPLATE_NAME');
    }
    if (value.ANTICA_STORAGE_DRIVER === 'local') {
      requireValue('ANTICA_STORAGE_LOCAL_ROOT');
      requireValue('ANTICA_STORAGE_SIGNING_SECRET');
    } else {
      requireValue('ANTICA_S3_BUCKET');
    }
    if (
      Boolean(value.AWS_ACCESS_KEY_ID) !== Boolean(value.AWS_SECRET_ACCESS_KEY)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['AWS_ACCESS_KEY_ID'],
        message: 'Both AWS credential fields are required together',
      });
    }
    if (value.NODE_ENV === 'production') {
      if (value.ANTICA_OTP_DRIVER === 'development') {
        context.addIssue({
          code: 'custom',
          path: ['ANTICA_OTP_DRIVER'],
          message: 'Development OTP is forbidden in production',
        });
      }
      if (value.ANTICA_STORAGE_DRIVER === 'local') {
        context.addIssue({
          code: 'custom',
          path: ['ANTICA_STORAGE_DRIVER'],
          message: 'Local storage is forbidden in production',
        });
      }
      if (new URL(value.BETTER_AUTH_URL).protocol !== 'https:') {
        context.addIssue({
          code: 'custom',
          path: ['BETTER_AUTH_URL'],
          message: 'Production requires HTTPS',
        });
      }
    }
  });

/** validated startup settings; secrets are never included in diagnostic output */
export type ApplicationConfig = z.infer<typeof environmentSchema>;

/**
 * validates all persistent adapter configuration before opening connections
 * @param env explicit server environment settings
 * @returns validated configuration or a redacted startup failure
 */
export function readApplicationConfig(
  env: Readonly<Record<string, string | undefined>>,
): OperationResult<ApplicationConfig> {
  const result = environmentSchema.safeParse(env);
  if (!result.success) {
    return {
      success: false,
      error: {
        code: 'VALIDATION_FAILED',
        message: `Invalid startup configuration: ${[...new Set(result.error.issues.map((issue) => issue.path.join('.')))].join(', ')}`,
        retryable: false,
      },
    };
  }

  return { success: true, data: result.data };
}
