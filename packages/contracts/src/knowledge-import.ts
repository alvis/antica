import { z } from 'zod';

import {
  knowledgeContentEnvelopeV2Schema,
  knowledgeSourceV2Schema,
} from './knowledge-v2.js';
import { entityIdSchema, instantSchema } from './shared.js';
import { structuredSourceSnapshotSchema } from './source-structured.js';

const maximumIdentifierLength = 200;
const maximumObjects = 250;
const maximumBytes = 65_536_000;
const minimumSqlBudget = 8;
const maximumSqlBudget = 4_000;
const maximumAdapterVersionLength = 100;
const maximumCursorPageLength = 2_048;
const maximumProviderLength = 64;

const objectIdSchema = z
  .string()
  .min(1)
  .max(maximumIdentifierLength)
  .refine((value) => !value.includes('://'));
const selectionBounds = {
  provider: z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/),
  maxObjects: z.int().min(1).max(maximumObjects),
  maxBytes: z.int().min(1).max(maximumBytes),
  deadline: instantSchema,
};

/** approved identifiers or a bounded provider-owned query; never a URL to crawl */
export const importSelectionSchema = z
  .discriminatedUnion('kind', [
    z.strictObject({
      ...selectionBounds,
      kind: z.literal('ids'),
      objectIds: z.array(objectIdSchema).min(1).max(maximumObjects),
    }),
    z.strictObject({
      ...selectionBounds,
      kind: z.literal('query'),
      query: z
        .strictObject({
          text: z
            .string()
            .min(1)
            .max(maximumIdentifierLength)
            .refine((value) => !value.includes('://'))
            .optional(),
          category: z
            .enum(['ceramics', 'bronzes', 'jades', 'furniture'])
            .optional(),
        })
        .refine(
          (query) => query.text !== undefined || query.category !== undefined,
        ),
    }),
  ])
  .refine(
    (selection) =>
      selection.kind !== 'ids' ||
      (new Set(selection.objectIds).size === selection.objectIds.length &&
        selection.objectIds.length <= selection.maxObjects),
  );
export type ImportSelection = z.infer<typeof importSelectionSchema>;

export const knowledgeImportRequestSchema = z.strictObject({
  requestKey: entityIdSchema,
  selection: importSelectionSchema,
  sqlOperationBudget: z
    .int()
    .min(minimumSqlBudget)
    .max(maximumSqlBudget)
    .default(maximumSqlBudget),
});
export type KnowledgeImportRequest = z.infer<
  typeof knowledgeImportRequestSchema
>;

/** versioned adapter position; query and mapper identities must match before resume */
export const providerCursorSchema = z.strictObject({
  version: z.literal(1),
  queryHash: z.string().regex(/^[a-f0-9]{64}$/),
  adapterVersion: z.string().min(1).max(maximumAdapterVersionLength),
  schemaVersion: z.literal(2),
  page: z.string().max(maximumCursorPageLength).optional(),
  offset: z.int().nonnegative().optional(),
  shard: z.string().max(maximumIdentifierLength).optional(),
  line: z.int().nonnegative().optional(),
  etag: z.string().max(maximumIdentifierLength).optional(),
});
export type ProviderCursor = z.infer<typeof providerCursorSchema>;
export const providerSnapshotSchema = structuredSourceSnapshotSchema;
export type ProviderSnapshot = z.infer<typeof providerSnapshotSchema>;

/** fully mapped source and pending object-example envelope, before owner ID binding */
export const mappedObjectSchema = z
  .strictObject({
    externalObject: z.strictObject({
      provider: z.string().min(1).max(maximumProviderLength),
      objectId: objectIdSchema,
      canonicalRecordUrl: z.url(),
      upstreamModifiedAt: instantSchema.optional(),
    }),
    source: knowledgeSourceV2Schema,
    draft: knowledgeContentEnvelopeV2Schema,
  })
  .refine(
    (mapped) =>
      mapped.draft.entryType === 'object_example' &&
      mapped.draft.origin === 'open_import' &&
      mapped.draft.editorialReview.state === 'pending' &&
      mapped.draft.claims.every(
        (claim) =>
          claim.review.state === 'pending' &&
          claim.variants.every((variant) => variant.review.state === 'pending'),
      ),
  );
export type MappedObject = z.infer<typeof mappedObjectSchema>;

/** opaque reviewed object identity, never an arbitrary fetch address */
export interface ObjectHandle {
  readonly objectId: string;
}
export type ProviderFetchResult =
  | { readonly kind: 'snapshot'; readonly value: ProviderSnapshot }
  | { readonly kind: 'unchanged' | 'missing' };

/** reviewed provider boundary; map is pure and makes no network or database calls */
export interface KnowledgeProviderAdapter {
  readonly provider: string;
  readonly adapterVersion: string;
  list(input: {
    readonly selection: ImportSelection;
    readonly cursor?: ProviderCursor;
    readonly limit: number;
    readonly signal: AbortSignal;
  }): Promise<{
    readonly objects: readonly ObjectHandle[];
    readonly next?: ProviderCursor;
  }>;
  fetch(input: {
    readonly object: ObjectHandle;
    readonly etag?: string;
    readonly signal: AbortSignal;
  }): Promise<ProviderFetchResult>;
  map(snapshot: ProviderSnapshot): MappedObject;
}
/** explicit allowlist supplied by composition; test adapters are never installed here */
export type KnowledgeProviderRegistry = ReadonlyMap<
  string,
  KnowledgeProviderAdapter
>;

/** retry metadata exposed by an adapter without retaining remote response bodies */
export class KnowledgeProviderError extends Error {
  public readonly code: string;
  public readonly retryable: boolean;
  public readonly retryAfter: string | undefined;

  /**
   * creates a bounded provider failure without retaining response bodies
   * @param input safe adapter error metadata
   * @param input.code stable provider failure code
   * @param input.retryable whether another attempt is permitted
   * @param input.retryAfter upstream minimum delay in seconds or HTTP date
   */
  constructor(input: {
    readonly code: string;
    readonly retryable: boolean;
    readonly retryAfter?: string;
  }) {
    super(input.code);
    this.code = input.code;
    this.retryable = input.retryable;
    this.retryAfter = input.retryAfter;
  }
}
