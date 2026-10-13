import { createHmac, timingSafeEqual } from 'node:crypto';
import { mkdir, open, readFile, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import { assertStorageKey } from './media-store.js';
import { verifyBytes } from './verify.js';

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
export interface LocalMediaConfig {
  readonly root: string;
  readonly publicBaseUrl: string;
  readonly signingSecret: string;
}

/**
 * creates a development-only private file store with signed API transfers
 * @param config
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

/** */
export class LocalMediaStore implements MediaStore {
  readonly #root: string;
  readonly #publicBaseUrl: string;
  readonly #secret: string;

  /** @param config */
  constructor(config: LocalMediaConfig) {
    this.#root = resolve(config.root);
    this.#publicBaseUrl = config.publicBaseUrl;
    this.#secret = config.signingSecret;
  }

  /** @param key */
  #path(key: string): string {
    assertStorageKey(key);

    return join(this.#root, key);
  }

  /** @param input */
  #token(input: LocalToken): string {
    const body = Buffer.from(JSON.stringify(input)).toString('base64url');
    const signature = createHmac('sha256', this.#secret)
      .update(body)
      .digest('base64url');

    return `${body}.${signature}`;
  }

  /**
   * @param token
   * @param mode
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

  /** @param input */
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

  /** @param token */
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
   * @param token
   * @param bytes
   * @param mimeType
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

  /** @param input */
  public async verifyOriginal(input: OriginalObject): Promise<void> {
    const path = this.#path(input.key);
    const metadata = await stat(path);
    if (metadata.size !== input.byteLength) {
      throw new Error('Stored media size mismatch');
    }
    verifyBytes(await readFile(path), input);
  }

  /** @param key */
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

  /** @param token */
  public async openReadToken(
    token: string,
  ): Promise<{ readonly bytes: Uint8Array; readonly mimeType: string }> {
    return this.read(this.#parse(token, 'read').key);
  }

  /** @param key */
  public async read(
    key: string,
  ): Promise<{ readonly bytes: Uint8Array; readonly mimeType: string }> {
    const bytes = await readFile(this.#path(key));
    const { sniffMime } = await import('./verify.js');

    return { bytes, mimeType: sniffMime(bytes) ?? 'application/octet-stream' };
  }

  /**
   * @param input
   * @param input.key
   * @param input.bytes
   * @param input.mimeType
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
   * @param input
   * @param input.key
   * @param input.bytes
   * @param input.mimeType
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
