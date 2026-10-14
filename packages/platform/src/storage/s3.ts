import { createHash } from 'node:crypto';

import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateBucketCommand,
  CreateMultipartUploadCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import { assertStorageKey } from './media-store.js';
import { sniffMime } from './verify.js';

import type {
  MediaStore,
  OriginalObject,
  SignedTransfer,
} from './media-store.js';

/** private bucket and transfer signing endpoints for S3 media storage */
export interface S3MediaConfig {
  readonly bucket: string;
  readonly region: string;
  readonly endpoint?: string;
  readonly publicEndpoint?: string;
  readonly credentials?: {
    readonly accessKeyId: string;
    readonly secretAccessKey: string;
  };
}

/**
 * creates a private S3 store; a separate public endpoint signs phone-reachable URLs
 * @param config bucket, region, optional endpoints, and credentials
 * @returns store with separate server and transfer signing clients
 */
export function createS3MediaStore(config: S3MediaConfig): S3MediaStore {
  return new S3MediaStore(config);
}

/** private S3 media storage with separate server and transfer endpoints */
export class S3MediaStore implements MediaStore {
  readonly #bucket: string;
  readonly #server: S3Client;
  readonly #signer: S3Client;

  /**
   * initializes private storage and transfer signing clients
   */
  constructor(config: S3MediaConfig) {
    this.#bucket = config.bucket;
    const shared = {
      region: config.region,
      credentials: config.credentials,
      forcePathStyle: Boolean(config.endpoint),
    };
    this.#server = new S3Client({ ...shared, endpoint: config.endpoint });
    this.#signer = new S3Client({
      ...shared,
      endpoint: config.publicEndpoint ?? config.endpoint,
    });
  }

  /**
   * creates a missing bucket only in development
   * @throws {Error} when bucket creation is requested in production
   */
  public async ensureDevelopmentBucket(): Promise<void> {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Bucket creation is development-only');
    }
    try {
      await this.#server.send(new HeadBucketCommand({ Bucket: this.#bucket }));
    } catch (error) {
      const status = (error as { $metadata?: { httpStatusCode?: number } })
        .$metadata?.httpStatusCode;
      if (status !== 404) {
        throw error;
      }
      await this.#server.send(
        new CreateBucketCommand({ Bucket: this.#bucket }),
      );
    }
  }

  /**
   * signs an immutable original upload with its declared checksum
   * @returns expiring upload URL and required checksum headers
   */
  public async signUpload(input: OriginalObject): Promise<SignedTransfer> {
    assertStorageKey(input.key);
    const command = new PutObjectCommand({
      Bucket: this.#bucket,
      Key: input.key,
      ContentType: input.mimeType,
      ContentLength: input.byteLength,
      ChecksumSHA256: Buffer.from(input.sha256, 'hex').toString('base64'),
      IfNoneMatch: '*',
    });
    const url = await getSignedUrl(this.#signer, command, {
      expiresIn: 15 * 60,
    });

    return {
      url,
      expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
      headers: {
        'Content-Type': input.mimeType,
        'x-amz-checksum-sha256': Buffer.from(input.sha256, 'hex').toString(
          'base64',
        ),
        'If-None-Match': '*',
      },
    };
  }

  /**
   * creates and signs the parts of a bounded multipart upload
   * @returns provider upload identity and signed URLs with byte ranges
   */
  public async startMultipart(input: OriginalObject) {
    assertStorageKey(input.key);
    const minimum = 5 * 1024 * 1024;
    const partSize = Math.max(
      16 * 1024 * 1024,
      Math.ceil(input.byteLength / 10_000 / minimum) * minimum,
    );
    if (partSize > 5 * 1024 * 1024 * 1024) {
      throw new RangeError('Original exceeds S3 multipart limits');
    }
    const count = Math.ceil(input.byteLength / partSize);
    const created = await this.#server.send(
      new CreateMultipartUploadCommand({
        Bucket: this.#bucket,
        Key: input.key,
        ContentType: input.mimeType,
      }),
    );
    if (!created.UploadId) {
      throw new Error('S3 did not return a multipart upload ID');
    }
    const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString();
    try {
      const parts = await Promise.all(
        Array.from({ length: count }, async (_, position) => {
          const partNumber = position + 1;
          const offset = position * partSize;
          const byteLength = Math.min(partSize, input.byteLength - offset);
          const putUrl = await getSignedUrl(
            this.#signer,
            new UploadPartCommand({
              Bucket: this.#bucket,
              Key: input.key,
              UploadId: created.UploadId!,
              PartNumber: partNumber,
              ContentLength: byteLength,
            }),
            { expiresIn: 15 * 60 },
          );

          return { partNumber, offset, byteLength, putUrl, headers: {} };
        }),
      );

      return { uploadId: created.UploadId, expiresAt, parts };
    } catch (error) {
      await this.abortMultipart(input, created.UploadId);
      throw error;
    }
  }

  /**
   * completes an ordered multipart upload and verifies its original
   * @param input immutable original identity and expected media checksum
   * @param uploadId provider upload identity returned by startMultipart
   * @param parts ordered part numbers and provider ETags for completion
   */
  public async completeMultipart(
    input: OriginalObject,
    uploadId: string,
    parts: ReadonlyArray<{
      readonly partNumber: number;
      readonly etag: string;
    }>,
  ): Promise<void> {
    assertStorageKey(input.key);
    if (!uploadId || !parts.length) {
      throw new Error('Multipart upload identity and parts are required');
    }
    const partSize = Math.max(
      16 * 1024 * 1024,
      Math.ceil(input.byteLength / 10_000 / (5 * 1024 * 1024)) *
        5 *
        1024 *
        1024,
    );
    const expectedCount = Math.ceil(input.byteLength / partSize);
    if (
      parts.length !== expectedCount ||
      parts.some(
        (part, index) =>
          part.partNumber !== index + 1 ||
          !part.etag ||
          part.etag.length > 256 ||
          /[\r\n]/.test(part.etag),
      )
    ) {
      throw new Error('Multipart completion parts are incomplete or unordered');
    }
    await this.#server.send(
      new CompleteMultipartUploadCommand({
        Bucket: this.#bucket,
        Key: input.key,
        UploadId: uploadId,
        MultipartUpload: {
          Parts: parts.map((part) => ({
            PartNumber: part.partNumber,
            ETag: part.etag,
          })),
        },
      }),
    );
    await this.verifyOriginal(input);
  }

  /**
   * aborts a multipart upload by its storage identity
   * @param input original object identifying the private storage key
   * @param uploadId provider upload identity to abort
   */
  public async abortMultipart(
    input: OriginalObject,
    uploadId: string,
  ): Promise<void> {
    assertStorageKey(input.key);
    if (!uploadId) {
      throw new Error('Multipart upload ID is required');
    }
    await this.#server.send(
      new AbortMultipartUploadCommand({
        Bucket: this.#bucket,
        Key: input.key,
        UploadId: uploadId,
      }),
    );
  }

  /**
   * verifies stored metadata and bytes against an immutable original
   */
  public async verifyOriginal(input: OriginalObject): Promise<void> {
    assertStorageKey(input.key);
    const metadata = await this.#server.send(
      new HeadObjectCommand({ Bucket: this.#bucket, Key: input.key }),
    );
    if (
      metadata.ContentLength !== input.byteLength ||
      metadata.ContentType !== input.mimeType
    ) {
      throw new Error('Stored media metadata mismatch');
    }
    const { bytes } = await this.read(input.key);
    if (bytes.byteLength !== input.byteLength) {
      throw new Error('Stored media size mismatch');
    }
    if (
      createHash('sha256').update(bytes).digest('hex') !==
      input.sha256.toLowerCase()
    ) {
      throw new Error('Stored media checksum mismatch');
    }
    if (sniffMime(bytes) !== input.mimeType) {
      throw new Error('Stored media MIME mismatch');
    }
  }

  /**
   * signs a read transfer for a private object
   * @returns expiring read URL for the requested private key
   */
  public async signRead(key: string): Promise<SignedTransfer> {
    assertStorageKey(key);
    const url = await getSignedUrl(
      this.#signer,
      new GetObjectCommand({ Bucket: this.#bucket, Key: key }),
      { expiresIn: 5 * 60 },
    );

    return {
      url,
      expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
      headers: {},
    };
  }

  /**
   * reads private object bytes and their stored media type
   * @returns stored bytes and provider or fallback media type
   */
  public async read(
    key: string,
  ): Promise<{ readonly bytes: Uint8Array; readonly mimeType: string }> {
    assertStorageKey(key);
    const response = await this.#server.send(
      new GetObjectCommand({ Bucket: this.#bucket, Key: key }),
    );
    if (!response.Body) {
      throw new Error('Stored media has no body');
    }
    const bytes = await response.Body.transformToByteArray();

    return {
      bytes,
      mimeType: response.ContentType ?? 'application/octet-stream',
    };
  }

  /**
   * writes immutable derivative bytes with their checksum
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
    assertStorageKey(input.key);
    await this.#server.send(
      new PutObjectCommand({
        Bucket: this.#bucket,
        Key: input.key,
        Body: input.bytes,
        ContentLength: input.bytes.byteLength,
        ContentType: input.mimeType,
        ChecksumSHA256: createHash('sha256')
          .update(input.bytes)
          .digest('base64'),
        IfNoneMatch: '*',
      }),
    );
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
