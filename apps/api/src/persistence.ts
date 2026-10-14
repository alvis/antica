import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import {
  collectorUserId,
  createAuthSession,
  createDatabase,
  createLocalMediaStore,
  createRetrievalReaders,
  createS3MediaStore,
  createTransactionPort,
  ensureCollectorUser,
} from '@antica/platform';

import type {
  ClockPort,
  IdPort,
  TransactionPort,
} from '@antica/application/ports';
import type {
  DatabaseConnection,
  LocalMediaStore,
  MediaStore,
  RetrievalReaders,
} from '@antica/platform';

import type { ApiAuth } from './application.js';
import type { ApplicationConfig } from './configuration.js';

/** shares only collector-scoped persistent adapters within the server composition */
export interface Persistence {
  readonly database: DatabaseConnection;
  readonly transaction: TransactionPort;
  readonly storage: MediaStore;
  readonly local: LocalMediaStore | undefined;
  readonly readers: RetrievalReaders;
  readonly auth: ApiAuth;
  readonly trustedOrigins: readonly string[];
  readonly clock: ClockPort;
  readonly ids: IdPort;
}

/**
 * opens persistence and the allowlisted collector session
 * @param config validated environment configuration
 * @returns initialized adapters with a closable database pool
 */
export async function createPersistence(
  config: ApplicationConfig,
): Promise<Persistence> {
  const database = createDatabase({ url: config.DATABASE_URL });
  try {
    await ensureCollectorUser({
      db: database.db,
      phoneNumber: config.ANTICA_COLLECTOR_PHONE,
    });
    if (config.ANTICA_DEV_OTP_INBOX) {
      await mkdir(dirname(resolve(config.ANTICA_DEV_OTP_INBOX)), {
        recursive: true,
        mode: 0o700,
      });
    }
    const trustedOrigins = config.ANTICA_ALLOWED_ORIGINS.split(',')
      .map((origin) => origin.trim())
      .filter(Boolean);
    const auth = createSession(config, database, trustedOrigins);
    const { local, storage } = createStorage(config);
    const transaction = createTransactionPort(database.db);
    const readers = createRetrievalReaders({
      db: database.db,
      transaction,
      storage,
      ownerId: collectorUserId,
    });

    return {
      database,
      transaction,
      storage,
      local,
      readers,
      auth,
      trustedOrigins,
      clock: { now: (): string => new Date().toISOString() },
      ids: { create: randomUUID },
    };
  } catch (cause) {
    await database.close();
    throw cause;
  }
}

/**
 * binds Better Auth to the configured persisted collector
 * @param config validated session settings
 * @param database typed database pool
 * @param trustedOrigins allowed native and web origins
 * @returns the server session boundary
 */
function createSession(
  config: ApplicationConfig,
  database: DatabaseConnection,
  trustedOrigins: readonly string[],
): ApiAuth {
  return createAuthSession(database.db, {
    baseUrl: config.BETTER_AUTH_URL,
    secret: config.BETTER_AUTH_SECRET,
    collectorPhoneNumber: config.ANTICA_COLLECTOR_PHONE,
    otpDriver: config.ANTICA_OTP_DRIVER,
    developmentInboxPath: config.ANTICA_DEV_OTP_INBOX,
    whatsappToken: config.WHATSAPP_TOKEN,
    whatsappPhoneNumberId: config.WHATSAPP_PHONE_NUMBER_ID,
    whatsappTemplateName: config.WHATSAPP_TEMPLATE_NAME,
    trustedOrigins,
  });
}

/**
 * creates the selected immutable private media store
 * @param config validated storage settings
 * @returns storage plus local transfer methods when selected
 */
function createStorage(config: ApplicationConfig): {
  readonly local: LocalMediaStore | undefined;
  readonly storage: MediaStore;
} {
  const local =
    config.ANTICA_STORAGE_DRIVER === 'local'
      ? createLocalMediaStore({
          root: resolve(config.ANTICA_STORAGE_LOCAL_ROOT!),
          publicBaseUrl: config.BETTER_AUTH_URL,
          signingSecret: config.ANTICA_STORAGE_SIGNING_SECRET!,
        })
      : undefined;
  const storage =
    local ??
    createS3MediaStore({
      bucket: config.ANTICA_S3_BUCKET!,
      region: config.ANTICA_S3_REGION,
      endpoint: config.ANTICA_S3_ENDPOINT,
      publicEndpoint: config.ANTICA_S3_PUBLIC_ENDPOINT,
      credentials:
        config.AWS_ACCESS_KEY_ID && config.AWS_SECRET_ACCESS_KEY
          ? {
              accessKeyId: config.AWS_ACCESS_KEY_ID,
              secretAccessKey: config.AWS_SECRET_ACCESS_KEY,
            }
          : undefined,
    });

  return { local, storage };
}
