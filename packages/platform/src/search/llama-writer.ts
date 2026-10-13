import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

import LlamaCloud from '@llamaindex/llama-cloud';

import { z } from 'zod';

import { validateIndexSpace } from './index-space.js';

import type {
  DurableTextIndexWriterPort,
  IndexIdentity,
  OperationResult,
  TextIndexHandle,
  TextIndexProgress,
} from '@antica/application/ports';

/** stores each bounded indexing continuation as an immutable private artifact */
export interface LlamaTextIndexWriterParams {
  readonly ownerId: string;
  readonly apiKey?: string;
  readonly indexId: string;
  readonly sourceDirectoryId: string;
  readonly index: IndexIdentity;
  readonly readCheckpoint: (assetId: string) => Promise<Uint8Array>;
  readonly writeCheckpoint: (bytes: Uint8Array) => Promise<string>;
  readonly fetch?: typeof globalThis.fetch;
}

const indexSchema = z.strictObject({
  embeddingModelId: z.string(),
  dimensions: z.number().int().positive(),
  indexVersion: z.string(),
});
const chunkSchema = z.strictObject({
  sourceVersionId: z.string(),
  parseRunId: z.string(),
  citationId: z.string(),
  canonicalRegionIds: z.array(z.string()).min(1),
  contentAsRetrieved: z.string().min(1),
});
const mappingSchema = z.strictObject({
  provider: z.literal('llama-cloud'),
  providerChunkId: z.string(),
  providerFigureId: z.null(),
  parseRunId: z.string(),
  indexVersion: z.string(),
  sourceVersionId: z.string(),
  canonicalRegionIds: z.array(z.string()),
});
const checkpointSchema = z.strictObject({
  version: z.literal(1),
  ownerId: z.string().min(1),
  indexId: z.string(),
  sourceDirectoryId: z.string(),
  sourceVersionId: z.string(),
  parseRunId: z.string(),
  index: indexSchema,
  phase: z.enum(['inspect', 'upload', 'recover', 'sync', 'wait', 'map']),
  chunks: z.array(chunkSchema),
  providerDocumentIds: z.array(z.string()),
  mappings: z.array(mappingSchema),
  mappedCount: z.number().int().nonnegative(),
  previousExport: z.string().nullable(),
});
type Checkpoint = z.infer<typeof checkpointSchema>;

/**
 * imports canonical text into Cloud v2 with one remote operation per continuation
 * @param params configured index and private checkpoint persistence
 * @returns durable writer that reports readiness only after exact returned chunk mapping
 */
export function createLlamaTextIndexWriter(
  params: LlamaTextIndexWriterParams,
): DurableTextIndexWriterPort {
  const client = () =>
    new LlamaCloud({
      apiKey: params.apiKey,
      maxRetries: 0,
      timeout: 30_000,
      logLevel: 'off',
      fetch: params.fetch,
    });
  async function waiting(
    checkpoint: Checkpoint,
  ): Promise<OperationResult<TextIndexProgress>> {
    const checkpointAssetId = await params.writeCheckpoint(
      new TextEncoder().encode(JSON.stringify(checkpoint)),
    );

    return {
      success: true,
      data: {
        kind: 'waiting',
        sourceVersionId: checkpoint.sourceVersionId,
        parseRunId: checkpoint.parseRunId,
        index: checkpoint.index,
        provider: 'llama-cloud',
        providerJobId: null,
        providerDocumentIds: checkpoint.providerDocumentIds,
        checkpointAssetId,
        resumeAfter: new Date(Date.now() + 1000).toISOString(),
      },
    };
  }

  return {
    submit: async (input) => {
      if (
        !params.apiKey?.trim() ||
        !params.indexId.trim() ||
        !params.sourceDirectoryId.trim() ||
        !params.ownerId.trim()
      ) {
        return failure(
          'LlamaCloud indexing requires credentials and explicit index/source-directory IDs.',
        );
      }
      if (!validateIndexSpace(params.index, input.index).valid) {
        return failure(
          'The requested text index does not match the configured embedding space.',
        );
      }
      const parsed = z.array(chunkSchema).safeParse(input.chunks);
      if (
        !parsed.success ||
        parsed.data.some(
          (chunk) =>
            chunk.sourceVersionId !== input.sourceVersionId ||
            chunk.parseRunId !== input.parseRunId,
        ) ||
        new Set(input.chunks.map((chunk) => chunk.citationId)).size !==
          input.chunks.length
      ) {
        return failure(
          'Canonical text chunks must belong to the frozen source and parse run and have unique citation IDs.',
        );
      }
      if (parsed.data.length === 0) {
        return {
          success: true,
          data: { kind: 'completed', mappings: [], indexedCount: 0 },
        };
      }
      try {
        return await waiting({
          version: 1,
          ownerId: params.ownerId,
          indexId: params.indexId,
          sourceDirectoryId: params.sourceDirectoryId,
          sourceVersionId: input.sourceVersionId,
          parseRunId: input.parseRunId,
          index: input.index,
          phase: 'inspect',
          chunks: parsed.data,
          providerDocumentIds: [],
          mappings: [],
          mappedCount: 0,
          previousExport: null,
        });
      } catch (cause) {
        return failure(
          'The text-index checkpoint could not be retained.',
          cause,
        );
      }
    },
    resume: async (handle) => {
      if (
        !params.apiKey?.trim() ||
        handle.provider !== 'llama-cloud' ||
        !validateIndexSpace(params.index, handle.index).valid
      ) {
        return failure(
          'The indexing handle or configured provider is unavailable.',
        );
      }
      try {
        const checkpoint = checkpointSchema.parse(
          JSON.parse(
            new TextDecoder().decode(
              await params.readCheckpoint(handle.checkpointAssetId),
            ),
          ),
        );
        if (!matchesHandle(checkpoint, handle, params)) {
          return failure(
            'The indexing checkpoint does not match the persisted job identity.',
          );
        }
        const provider = client();
        if (checkpoint.phase === 'inspect') {
          const index = await provider.indexes.get(params.indexId);
          if (
            index.id !== params.indexId ||
            index.source_directory_id !== params.sourceDirectoryId
          ) {
            return failure(
              'The configured Cloud index does not use the configured source directory.',
            );
          }

          return await waiting({
            ...checkpoint,
            phase: 'upload',
            previousExport: index.last_exported_at ?? null,
          });
        }
        if (checkpoint.phase === 'upload' || checkpoint.phase === 'recover') {
          const chunk =
            checkpoint.chunks[checkpoint.providerDocumentIds.length];
          if (!chunk) {
            return failure(
              'The upload checkpoint cursor is outside the retained canonical chunks.',
            );
          }
          const uniqueId = createHash('sha256')
            .update(
              JSON.stringify({
                ownerId: params.ownerId,
                index: checkpoint.index,
                sourceVersionId: chunk.sourceVersionId,
                parseRunId: chunk.parseRunId,
                citationId: chunk.citationId,
                text: chunk.contentAsRetrieved,
              }),
            )
            .digest('hex');
          const metadata = {
            anticaContentHash: createHash('sha256')
              .update(chunk.contentAsRetrieved)
              .digest('hex'),
            anticaOwnerId: params.ownerId,
            anticaSourceVersionId: chunk.sourceVersionId,
            anticaParseRunId: chunk.parseRunId,
            anticaCitationId: chunk.citationId,
            anticaRegionIds: chunk.canonicalRegionIds,
            anticaIndexVersion: checkpoint.index.indexVersion,
          };
          const uploaded =
            checkpoint.phase === 'recover'
              ? (
                  await provider.beta.directories.files.list(
                    params.sourceDirectoryId,
                    { unique_id: uniqueId, page_size: 2 },
                  )
                ).items[0]
              : await provider.beta.directories.files
                  .upload(params.sourceDirectoryId, {
                    upload_file: new File(
                      [chunk.contentAsRetrieved],
                      `${uniqueId}.txt`,
                      { type: 'text/plain' },
                    ),
                    unique_id: uniqueId,
                    metadata: JSON.stringify(metadata),
                  })
                  .catch((cause: unknown) => {
                    if (
                      cause instanceof LlamaCloud.APIError &&
                      cause.status !== 409 &&
                      cause.status !== undefined &&
                      cause.status < 500
                    ) {
                      throw cause;
                    }
                    return null;
                  });
          if (!uploaded) {
            return await waiting({
              ...checkpoint,
              phase: checkpoint.phase === 'recover' ? 'upload' : 'recover',
            });
          }
          if (
            !uploaded.id ||
            uploaded.unique_id !== uniqueId ||
            uploaded.directory_id !== params.sourceDirectoryId ||
            !Object.entries(metadata).every(([key, value]) =>
              isDeepStrictEqual(uploaded.metadata?.[key], value),
            )
          ) {
            return failure(
              'Cloud upload did not preserve the canonical text identity.',
            );
          }
          const ids = [...checkpoint.providerDocumentIds, uploaded.id];

          return await waiting({
            ...checkpoint,
            providerDocumentIds: ids,
            phase: ids.length === checkpoint.chunks.length ? 'sync' : 'upload',
          });
        }
        if (checkpoint.phase === 'sync') {
          await provider.indexes.sync(params.indexId);

          return await waiting({ ...checkpoint, phase: 'wait' });
        }
        if (checkpoint.phase === 'wait') {
          const index = await provider.indexes.get(params.indexId, {
            expand: ['sync_in_progress'],
          });
          if (
            index.id !== params.indexId ||
            index.source_directory_id !== params.sourceDirectoryId
          ) {
            return failure('The Cloud index identity changed during indexing.');
          }
          if (
            index.metadata?.status === 'failed' ||
            index.metadata?.status === 'error'
          ) {
            return failure(
              'Cloud indexing failed; the source remains unavailable for retrieval.',
            );
          }
          if (
            index.metadata?.status !== 'ready' ||
            index.sync_in_progress !== false ||
            !index.last_exported_at ||
            index.last_exported_at === checkpoint.previousExport
          ) {
            return await waiting(checkpoint);
          }

          return await waiting({ ...checkpoint, phase: 'map' });
        }
        const chunk = checkpoint.chunks[checkpoint.mappedCount];
        if (!chunk) {
          return failure(
            'The mapping checkpoint cursor is outside the retained canonical chunks.',
          );
        }
        const result = await provider.retrieval.retrieve({
          index_id: params.indexId,
          query: chunk.contentAsRetrieved,
          top_k: 100,
          custom_filters: {
            anticaOwnerId: { operator: 'eq', value: params.ownerId },
            anticaSourceVersionId: {
              operator: 'eq',
              value: chunk.sourceVersionId,
            },
            anticaParseRunId: { operator: 'eq', value: chunk.parseRunId },
            anticaCitationId: { operator: 'eq', value: chunk.citationId },
            anticaIndexVersion: {
              operator: 'eq',
              value: checkpoint.index.indexVersion,
            },
          },
        });
        const matches = result.results.filter(
          (item) =>
            item.content === chunk.contentAsRetrieved &&
            item.metadata?.anticaOwnerId === params.ownerId &&
            item.metadata.anticaSourceVersionId === chunk.sourceVersionId &&
            item.metadata.anticaParseRunId === chunk.parseRunId &&
            item.metadata.anticaCitationId === chunk.citationId &&
            item.metadata.anticaIndexVersion ===
              checkpoint.index.indexVersion &&
            isDeepStrictEqual(
              item.metadata.anticaRegionIds,
              chunk.canonicalRegionIds,
            ) &&
            !!item.static_fields?.parsed_directory_file_id &&
            Number.isSafeInteger(item.static_fields.chunk_index) &&
            item.static_fields.chunk_index! >= 0,
        );
        if (matches.length === 0) {
          return failure(
            'Cloud returned no exact complete canonical text chunk; split or transformed text requires source review.',
          );
        }
        const newMappings = matches.map((item) => ({
          provider: 'llama-cloud' as const,
          providerChunkId: `${item.static_fields!.parsed_directory_file_id!}:${item.static_fields!.chunk_index!}`,
          providerFigureId: null,
          parseRunId: chunk.parseRunId,
          indexVersion: checkpoint.index.indexVersion,
          sourceVersionId: chunk.sourceVersionId,
          canonicalRegionIds: chunk.canonicalRegionIds,
        }));
        if (
          newMappings.some((mapping) =>
            checkpoint.mappings.some(
              (existing) =>
                existing.providerChunkId === mapping.providerChunkId &&
                !isDeepStrictEqual(existing, mapping),
            ),
          )
        ) {
          return failure(
            'Cloud reused one chunk identity for different canonical sources.',
          );
        }
        const mappings = [
          ...new Map(
            [...checkpoint.mappings, ...newMappings].map((mapping) => [
              mapping.providerChunkId,
              mapping,
            ]),
          ).values(),
        ];
        const mappedCount = checkpoint.mappedCount + 1;
        if (mappedCount === checkpoint.chunks.length) {
          return {
            success: true,
            data: { kind: 'completed', mappings, indexedCount: mappedCount },
          };
        }

        return await waiting({ ...checkpoint, mappings, mappedCount });
      } catch (cause) {
        return failure(
          'The Cloud indexing continuation could not be completed.',
          cause,
        );
      }
    },
  };
}

/**
 * checks that a private checkpoint belongs to the current indexing job
 * @param checkpoint decoded private progress artifact
 * @param handle persisted indexing continuation
 * @param params configured owner and index identity
 * @returns whether every persisted identity agrees
 */
function matchesHandle(
  checkpoint: Checkpoint,
  handle: TextIndexHandle,
  params: LlamaTextIndexWriterParams,
): boolean {
  return (
    checkpoint.ownerId === params.ownerId &&
    checkpoint.indexId === params.indexId &&
    checkpoint.sourceDirectoryId === params.sourceDirectoryId &&
    checkpoint.sourceVersionId === handle.sourceVersionId &&
    checkpoint.parseRunId === handle.parseRunId &&
    validateIndexSpace(checkpoint.index, handle.index).valid &&
    isDeepStrictEqual(
      checkpoint.providerDocumentIds,
      handle.providerDocumentIds,
    )
  );
}

/**
 * reports indexing failures without declaring unverified content searchable
 * @param message failure detail
 * @param cause optional internal provider or storage failure
 * @returns explicit source failure
 */
function failure(
  message: string,
  cause?: unknown,
): OperationResult<TextIndexProgress> {
  return {
    success: false,
    error: {
      code: 'SOURCE_UNAVAILABLE',
      message,
      retryable: cause !== undefined,
    },
    cause,
  };
}
