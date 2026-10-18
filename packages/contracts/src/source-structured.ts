import { z } from 'zod';

import { instantSchema } from './shared.js';

export type CanonicalJson =
  | boolean
  | number
  | string
  | null
  | readonly CanonicalJson[]
  | { readonly [key: string]: CanonicalJson };

const maximumTextLength = 24_000;
const maximumUrlLength = 2_048;
const maximumKeyLength = 200;
const maximumObjectIdLength = 1_000;
const maximumRightsFacts = 100;
const maximumJsonItems = 10_000;
const maximumJsonDepth = 32;
const maximumPayloadLength = 1_048_576;
const minimumUnpaddedBase64Length = 128;
const base64QuantumLength = 4;

const boundedSourceTextSchema = z.string().min(1).max(maximumTextLength);
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const httpUrlSchema = z
  .string()
  .max(maximumUrlLength)
  .url()
  .refine(
    (value) => value.startsWith('http://') || value.startsWith('https://'),
  );

export const observedRightsSchema = z.strictObject({
  statement: boundedSourceTextSchema.optional(),
  name: boundedSourceTextSchema.optional(),
  uri: httpUrlSchema.optional(),
  version: boundedSourceTextSchema.optional(),
  holder: boundedSourceTextSchema.optional(),
  attribution: boundedSourceTextSchema.optional(),
  scope: boundedSourceTextSchema.optional(),
  fieldPath: z.string().max(maximumUrlLength).optional(),
  modificationNotice: boundedSourceTextSchema.optional(),
  observedAt: instantSchema,
  evidenceUrl: httpUrlSchema,
  evidenceHash: sha256Schema.optional(),
});

export const canonicalJsonSchema = z
  .custom<CanonicalJson>(isCanonicalJson)
  .refine((value) => JSON.stringify(value).length <= maximumPayloadLength);
export const structuredSourceSnapshotSchema = z.strictObject({
  provider: z.string().min(1).max(maximumKeyLength),
  objectId: z.string().min(1).max(maximumObjectIdLength),
  payloadHash: sha256Schema,
  schemaVersion: z.string().min(1).max(maximumKeyLength),
  sourceHash: sha256Schema,
  sourcePageUrl: httpUrlSchema,
  retrievedAt: instantSchema,
  payload: canonicalJsonSchema,
  observedRights: z
    .array(observedRightsSchema)
    .max(maximumRightsFacts)
    .optional(),
});
export type StructuredSourceSnapshot = z.infer<
  typeof structuredSourceSnapshotSchema
>;

/**
 * Validates finite bounded JSON without binary or encoded binary fields.
 * @param value candidate JSON value
 * @param depth current traversal depth
 * @returns whether the value is safe canonical JSON metadata
 */
function isCanonicalJson(value: unknown, depth = 0): value is CanonicalJson {
  if (depth > maximumJsonDepth) {
    return false;
  }
  if (
    value === null ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  ) {
    return true;
  }
  if (typeof value === 'string') {
    return (
      value.length <= maximumTextLength &&
      !value.startsWith('data:') &&
      !looksLikeBase64(value)
    );
  }
  if (Array.isArray(value)) {
    return (
      value.length <= maximumJsonItems &&
      value.every((item) => isCanonicalJson(item, depth + 1))
    );
  }
  if (typeof value !== 'object') {
    return false;
  }

  const prototype = Object.getPrototypeOf(value) as object | null;
  if (prototype !== Object.prototype && prototype !== null) {
    return false;
  }

  const entries = Object.entries(value);

  return (
    entries.length <= maximumJsonItems &&
    entries.every(
      ([key, item]) =>
        key.length <= maximumKeyLength &&
        !/(?:base64|binary|bytes|blob|imageData)/i.test(key) &&
        isCanonicalJson(item, depth + 1),
    )
  );
}

/**
 * Identifies padded and long unpadded base64 strings.
 * @param value candidate string
 * @returns whether the string resembles encoded binary data
 */
function looksLikeBase64(value: string): boolean {
  return (
    /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)$/.test(
      value,
    ) ||
    (value.length >= minimumUnpaddedBase64Length &&
      value.length % base64QuantumLength === 0 &&
      /^[A-Za-z0-9+/]+$/.test(value))
  );
}
