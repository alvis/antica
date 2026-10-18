import { createHmac, timingSafeEqual } from 'node:crypto';
import { mkdir, open, readFile, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import { OriginalVerificationError } from '@antica/application/ports';

import { assertStorageKey } from './media-store.js';
import { sniffMime, verifyBytes } from './verify.js';

import type {
  MediaStore,
  OriginalObject,
  SignedTransfer,
} from './media-store.js';

interface LocalToken {
  readonly mode: 'upload' | 'read';
  readonly key: string;
  readonly expiresAt: number;
  readonly mimeType?: string;
  readonly byteLength?: number;
  readonly sha256?: string;
}

/** development file storage location and transfer signing settings */
export interface LocalMediaConfig {
  readonly root: string;
  readonly publicBaseUrl: string;
  readonly signingSecret: string;
}

/**
 * creates a development-only private file store with signed API transfers
 * @param config private root, public API base URL, and signing secret
 * @returns configured local store after environment and secret validation
 * @throws {Error} when used in production or the signing secret is shorter than 32 characters
 */
export function createLocalMediaStore(
  config: LocalMediaConfig,
): LocalMediaStore {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Local media storage is disabled in production');
  }
  if (config.signingSecret.length < 32) {
    throw new Error(
      'Local media signing secret must contain at least 32 characters',
    );
  }

  return new LocalMediaStore(config);
}

/** local signed media storage backed by private files */
export class LocalMediaStore implements MediaStore {
  readonly #root: string;
  readonly #publicBaseUrl: string;
  readonly #secret: string;

  /**
   * initializes private file storage with signed transfer configuration
   */
  constructor(config: LocalMediaConfig) {
    this.#root = resolve(config.root);
    this.#publicBaseUrl = config.publicBaseUrl;
    this.#secret = config.signingSecret;
  }
  #path(key: string): string {
    assertStorageKey(key);

    return join(this.#root, key);
  }
  #token(input: LocalToken): string {
    const body = Buffer.from(JSON.stringify(input)).toString('base64url');
    const signature = createHmac('sha256', this.#secret)
      .update(body)
      .digest('base64url');

    return `${body}.${signature}`;
  }

  /**
   * validates a signed token for the requested transfer mode
   * @param token signed transfer token supplied by the caller
   * @param mode upload or read mode expected by this operation
   * @returns decoded token after signature, mode, expiry, and key validation
   */
  #parse(token: string, mode: LocalToken['mode']): LocalToken {
    const [body, signature] = token.split('.');
    if (!body || !signature) {
      throw new Error('Invalid media token');
    }
    const actual = Buffer.from(signature, 'base64url');
    const expected = createHmac('sha256', this.#secret).update(body).digest();
    if (
      actual.length !== expected.length ||
      !timingSafeEqual(actual, expected)
    ) {
      throw new Error('Invalid media token');
    }
    const value = JSON.parse(
      Buffer.from(body, 'base64url').toString('utf8'),
    ) as LocalToken;
    if (value.mode !== mode || value.expiresAt <= Date.now()) {
      throw new Error('Expired media token');
    }
    assertStorageKey(value.key);

    return value;
  }

  /**
   * creates a signed upload transfer for an immutable original
   * @returns expiring upload URL and required content-type header
   */
  public async signUpload(input: OriginalObject): Promise<SignedTransfer> {
    const expiresAt = Date.now() + 15 * 60_000;
    const token = this.#token({
      mode: 'upload',
      key: input.key,
      expiresAt,
      mimeType: input.mimeType,
      byteLength: input.byteLength,
      sha256: input.sha256,
    });

    return {
      url: new URL(
        `/v1/storage/uploads/${token}`,
        this.#publicBaseUrl,
      ).toString(),
      expiresAt: new Date(expiresAt).toISOString(),
      headers: { 'Content-Type': input.mimeType },
    };
  }

  /**
   * verifies an upload token and returns its declared media metadata
   * @returns byte length and media type bound into the signed token
   */
  public validateUploadToken(token: string): {
    readonly byteLength: number;
    readonly mimeType: string;
  } {
    const value = this.#parse(token, 'upload');
    if (!value.byteLength || !value.mimeType || !value.sha256) {
      throw new Error('Upload declaration mismatch');
    }

    return { byteLength: value.byteLength, mimeType: value.mimeType };
  }

  /**
   * accepts bytes only when they match the signed upload declaration
   * @param token signed upload token carrying the original declaration
   * @param bytes original bytes to verify and store once
   * @param mimeType media type declared by the upload request
   */
  public async acceptUploadToken(
    token: string,
    bytes: Uint8Array,
    mimeType: string,
  ): Promise<void> {
    const value = this.#parse(token, 'upload');
    if (!value.byteLength || !value.sha256 || value.mimeType !== mimeType) {
      throw new Error('Upload declaration mismatch');
    }
    verifyBytes(bytes, {
      byteLength: value.byteLength,
      sha256: value.sha256,
      mimeType,
    });
    const path = this.#path(value.key);
    await mkdir(dirname(path), { recursive: true });
    const handle = await open(path, 'wx', 0o600);
    try {
      await handle.writeFile(bytes);
    } finally {
      await handle.close();
    }
  }

  /**
   * verifies persisted original bytes against their immutable declaration
   */
  public async verifyOriginal(input: OriginalObject): Promise<void> {
    const path = this.#path(input.key);
    try {
      const metadata = await stat(path);
      if (metadata.size !== input.byteLength) {
        throw new OriginalVerificationError({
          reason: 'mismatch',
          message: 'Stored media size mismatch',
        });
      }
      verifyBytes(await readFile(path), input);
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new OriginalVerificationError({
          reason: 'absent',
          message: 'Original media object not found',
          cause,
        });
      }
      throw cause;
    }
  }

  /**
   * creates a signed read transfer for a private object
   * @returns expiring read URL for the requested private key
   */
  public async signRead(key: string): Promise<SignedTransfer> {
    const expiresAt = Date.now() + 5 * 60_000;
    const token = this.#token({ mode: 'read', key, expiresAt });

    return {
      url: new URL(
        `/v1/storage/reads/${token}`,
        this.#publicBaseUrl,
      ).toString(),
      expiresAt: new Date(expiresAt).toISOString(),
      headers: {},
    };
  }

  /**
   * reads the private object selected by a signed read token
   * @returns stored bytes and detected media type
   */
  public async openReadToken(
    token: string,
  ): Promise<{ readonly bytes: Uint8Array; readonly mimeType: string }> {
    return this.read(this.#parse(token, 'read').key);
  }

  /**
   * reads private object bytes and detects their media type
   * @returns stored bytes and detected or fallback media type
   */
  public async read(
    key: string,
  ): Promise<{ readonly bytes: Uint8Array; readonly mimeType: string }> {
    const bytes = await readFile(this.#path(key));
    return { bytes, mimeType: sniffMime(bytes) ?? 'application/octet-stream' };
  }

  /**
   * writes derivative bytes under their assigned private key
   * @param input private object key, bytes, and declared media type
   * @param input.key assigned private object key
   * @param input.bytes immutable derivative contents
   * @param input.mimeType declared media type of the derivative
   */
  public async writeDerivative(input: {
    readonly key: string;
    readonly bytes: Uint8Array;
    readonly mimeType: string;
  }): Promise<void> {
    const path = this.#path(input.key);
    await mkdir(dirname(path), { recursive: true });
    const handle = await open(path, 'wx', 0o600);
    try {
      await handle.writeFile(input.bytes);
    } finally {
      await handle.close();
    }
  }

  /**
   * writes an artifact only under the artifact key prefix
   * @param input artifact key, bytes, and declared media type
   * @param input.key assigned key under the artifacts prefix
   * @param input.bytes immutable artifact contents
   * @param input.mimeType declared media type of the artifact
   */
  public async writeArtifact(input: {
    readonly key: string;
    readonly bytes: Uint8Array;
    readonly mimeType: string;
  }): Promise<void> {
    if (!input.key.startsWith('artifacts/')) {
      throw new Error('Invalid artifact key');
    }
    await this.writeDerivative(input);
  }
}
