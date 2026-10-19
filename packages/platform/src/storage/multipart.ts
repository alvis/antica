import { ListPartsCommand, UploadPartCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import type { S3Client } from '@aws-sdk/client-s3';

import type { MultipartTransfer, UploadedPart } from './media-store.js';

/** bucket, key, and provider identity of one multipart upload */
interface UploadTarget {
  readonly bucket: string;
  readonly key: string;
  readonly uploadId: string;
}

/** lifetime of every signed upload transfer: 15 minutes */
export const TRANSFER_SECONDS = 900;

/** byte range of one part in the deterministic multipart layout */
export interface PartRange {
  readonly partNumber: number;
  readonly offset: number;
  readonly byteLength: number;
}

/** smallest S3 part size other than the final part: 5 MiB */
const MIN_PART_BYTES = 5_242_880;
/** preferred part size for typical originals: 16 MiB */
const DEFAULT_PART_BYTES = 16_777_216;
/** largest S3 part size: 5 GiB */
const MAX_PART_BYTES = 5_368_709_120;
/** most parts S3 accepts in one multipart upload */
const MAX_PARTS = 10_000;
const MILLISECONDS_PER_SECOND = 1000;

/**
 * derives the one multipart layout shared by start, resume, and completion
 * @param byteLength declared size of the immutable original
 * @returns ordered part ranges covering every byte exactly once
 * @throws {RangeError} when the original exceeds S3 multipart limits
 */
export function planParts(byteLength: number): readonly PartRange[] {
  const partSize = Math.max(
    DEFAULT_PART_BYTES,
    Math.ceil(byteLength / MAX_PARTS / MIN_PART_BYTES) * MIN_PART_BYTES,
  );
  if (partSize > MAX_PART_BYTES) {
    throw new RangeError('Original exceeds S3 multipart limits');
  }

  return Array.from(
    { length: Math.ceil(byteLength / partSize) },
    (_, position) => ({
      partNumber: position + 1,
      offset: position * partSize,
      byteLength: Math.min(partSize, byteLength - position * partSize),
    }),
  );
}

/**
 * recognizes the provider error for an aborted or expired multipart upload
 * @param error failure raised by the S3 client
 * @returns whether the provider no longer holds the upload
 */
function isMissingUpload(error: unknown): boolean {
  return error instanceof Error && error.name === 'NoSuchUpload';
}

/**
 * computes when transfers signed now stop being accepted
 * @returns ISO instant one transfer lifetime from now
 */
export function transferExpiry(): string {
  return new Date(
    Date.now() + TRANSFER_SECONDS * MILLISECONDS_PER_SECOND,
  ).toISOString();
}

/**
 * signs part uploads for one multipart identity and layout
 * @param signer client whose endpoint the collector can reach
 * @param target bucket, key, and provider upload identity
 * @param plan ordered byte ranges to sign
 * @returns expiring part URLs bound to their exact content length
 */
export async function signPartTransfers(
  signer: S3Client,
  target: UploadTarget,
  plan: readonly PartRange[],
): Promise<MultipartTransfer> {
  const expiresAt = transferExpiry();
  const parts = await Promise.all(
    plan.map(async (range) => ({
      ...range,
      putUrl: await getSignedUrl(
        signer,
        new UploadPartCommand({
          Bucket: target.bucket,
          Key: target.key,
          UploadId: target.uploadId,
          PartNumber: range.partNumber,
          ContentLength: range.byteLength,
        }),
        { expiresIn: TRANSFER_SECONDS },
      ),
      headers: {},
    })),
  );

  return { uploadId: target.uploadId, expiresAt, parts };
}

/**
 * lists every stored part of a multipart upload across result pages
 * @param server client for the private storage endpoint
 * @param target bucket, key, and provider upload identity
 * @returns stored part numbers and ETags in provider order, or null when the provider no longer holds the upload
 * @throws {Error} when a truncated page omits its continuation marker
 */
export async function listUploadedParts(
  server: S3Client,
  target: UploadTarget,
): Promise<UploadedPart[] | null> {
  const uploaded: UploadedPart[] = [];
  let marker: string | undefined;
  do {
    const page = await server
      .send(
        new ListPartsCommand({
          Bucket: target.bucket,
          Key: target.key,
          UploadId: target.uploadId,
          PartNumberMarker: marker,
        }),
      )
      .catch((error: unknown) => {
        if (isMissingUpload(error)) {
          return null;
        }
        throw error;
      });
    if (!page) {
      return null;
    }
    for (const part of page.Parts ?? []) {
      if (part.PartNumber && part.ETag) {
        uploaded.push({ partNumber: part.PartNumber, etag: part.ETag });
      }
    }
    if (page.IsTruncated && !page.NextPartNumberMarker) {
      throw new Error('S3 truncated the part list without a marker');
    }
    marker = page.IsTruncated ? page.NextPartNumberMarker : undefined;
  } while (marker);

  return uploaded;
}
