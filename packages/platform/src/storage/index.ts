export { createLocalMediaStore, LocalMediaStore } from './local.js';
export { createS3MediaStore, S3MediaStore } from './s3.js';
export { artifactKey, derivativeKey, originalKey } from './media-store.js';
export type { LocalMediaConfig } from './local.js';
export type { S3MediaConfig } from './s3.js';
export type {
  MediaStore,
  MultipartResume,
  MultipartTransfer,
  OriginalObject,
  SignedTransfer,
  UploadedPart,
} from './media-store.js';
