import { createHash } from 'node:crypto';

import { ComponentInUseError } from '../ports/index.js';

import type { MediaStoragePort } from '../evidence/media.js';
import type {
  RecordCreate,
  RecordDetail,
  RecordPatch,
  CollectionQuery,
  CursorPage,
  RecordSummary,
} from '@antica/contracts';

import type {
  TransactionPort,
  ClockPort,
  IdPort,
  OperationResult,
} from '../ports/index.js';

/** supplies authenticated record operations backed by one transaction per command */
export interface RecordService {
  create(
    ownerId: string,
    requestKey: string,
    input: RecordCreate,
  ): Promise<OperationResult<RecordDetail>>;
  get(
    ownerId: string,
    recordId: string,
  ): Promise<OperationResult<RecordDetail>>;
  list(
    ownerId: string,
    query: CollectionQuery,
  ): Promise<OperationResult<CursorPage<RecordSummary>>>;
  patch(
    ownerId: string,
    recordId: string,
    requestKey: string,
    input: RecordPatch,
  ): Promise<OperationResult<RecordDetail>>;
}

/**
 * creates the collection use cases
 * @param transaction
 * @param clock
 * @param ids
 * @param storage
 */
export function createRecordService(
  transaction: TransactionPort,
  clock: ClockPort,
  ids: IdPort,
  storage?: Pick<MediaStoragePort, 'signRead'>,
): RecordService {
  return {
    create: async (ownerId, requestKey, input) =>
      transaction.run(ownerId, async (unit) => {
        const fingerprint = fingerprintOf(input);
        const prior = await unit.commands.get(
          ownerId,
          'records.create',
          requestKey,
        );
        if (prior) {
          return prior.fingerprint === fingerprint
            ? { success: true, data: prior.result as RecordDetail }
            : {
                success: false,
                error: {
                  code: 'VALIDATION_FAILED',
                  message: 'Idempotency key was used for a different request',
                  retryable: false,
                },
              };
        }
        const now = clock.now();
        const record: RecordDetail = {
          name: input.name ?? null,
          unitKind: input.unitKind,
          components: input.components ?? [],
          pieceCount: input.pieceCount ?? null,
          categoryIds: input.categoryIds ?? [],
          materialIds: input.materialIds ?? [],
          period: input.period ?? null,
          dimensions: input.dimensions ?? {},
          location: input.location ?? { locationId: null, detail: '' },
          acquisition: input.acquisition ?? { receiptAssetIds: [] },
          tags: input.tags ?? [],
          description: input.description ?? '',
          collectorJudgment: input.collectorJudgment ?? null,
          id: ids.create(),
          code: await unit.records.allocateCode(),
          recordRevision: 1,
          analysisInputVersion: 1,
          evidenceVersion: 1,
          createdAt: now,
          updatedAt: now,
          mediaIds: [],
          checkIds: [],
          latestRunId: null,
          analysisFreshness: 'unanalyzed',
        };
        await unit.records.create(record);
        await unit.commands.insert({
          ownerId,
          operation: 'records.create',
          requestKey,
          fingerprint,
          status: 201,
          result: record,
        });

        return { success: true, data: record };
      }),
    get: async (ownerId, recordId) =>
      transaction.run(ownerId, async (unit) => {
        const record = await unit.records.get(recordId);

        return record
          ? { success: true, data: record }
          : {
              success: false,
              error: {
                code: 'NOT_FOUND',
                message: 'Record not found',
                retryable: false,
              },
            };
      }),
    list: async (ownerId, query) => {
      const found = await transaction.run(ownerId, async (unit) => {
        const page = await unit.records.query(query);
        const targets =
          storage && page.items.length > 0
            ? await unit.records.getThumbnailTargets(
                page.items.map((item) => item.id),
              )
            : [];

        return { success: true as const, data: { page, targets } };
      });
      const { page, targets } = found.data;
      const urls = storage
        ? new Map(
            await Promise.all(
              targets.map(
                async ({ recordId, storageKey }) =>
                  [recordId, (await storage.signRead(storageKey)).url] as const,
              ),
            ),
          )
        : new Map<string, string>();

      return {
        success: true,
        data: {
          ...page,
          items: page.items.map((item) => ({
            ...item,
            coverThumbnail: urls.get(item.id) ?? null,
          })),
        },
      };
    },
    patch: async (ownerId, recordId, requestKey, input) => {
      try {
        return await transaction.run(ownerId, async (unit) => {
          const fingerprint = fingerprintOf({ recordId, input });
          const prior = await unit.commands.get(
            ownerId,
            'records.patch',
            requestKey,
          );
          if (prior) {
            return prior.fingerprint === fingerprint
              ? { success: true, data: prior.result as RecordDetail }
              : {
                  success: false,
                  error: {
                    code: 'VALIDATION_FAILED',
                    message: 'Idempotency key was used for a different request',
                    retryable: false,
                  },
                };
          }
          const current = await unit.records.get(recordId);
          if (!current) {
            return {
              success: false,
              error: {
                code: 'NOT_FOUND',
                message: 'Record not found',
                retryable: false,
              },
            };
          }
          if (current.recordRevision !== input.expectedRevision) {
            return {
              success: false,
              error: {
                code: 'REVISION_CONFLICT',
                message: 'Record changed since it was opened',
                retryable: true,
              },
            };
          }
          if (input.editDraftId !== undefined) {
            return {
              success: false,
              error: {
                code: 'VALIDATION_FAILED',
                message: 'Edit draft adoption is not configured',
                retryable: false,
              },
            };
          }
          const relevant = Object.keys(input.fields).some(
            (key) => key !== 'location' && key !== 'acquisition',
          );
          const versions = {
            recordRevision: current.recordRevision + 1,
            analysisInputVersion:
              current.analysisInputVersion + Number(relevant),
            evidenceVersion: current.evidenceVersion,
          };
          const updated = await unit.records.patch(recordId, input, versions);
          if (!updated) {
            return {
              success: false,
              error: {
                code: 'REVISION_CONFLICT',
                message: 'Record changed during update',
                retryable: true,
              },
            };
          }
          await unit.commands.insert({
            ownerId,
            operation: 'records.patch',
            requestKey,
            fingerprint,
            status: 200,
            result: updated,
          });

          return { success: true, data: updated };
        });
      } catch (error) {
        if (error instanceof ComponentInUseError) {
          return {
            success: false,
            error: {
              code: 'VALIDATION_FAILED',
              message: error.message,
              retryable: false,
            },
          };
        }
        throw error;
      }
    },
  };
}

/** @param value */
function fingerprintOf(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(sortJson(value)))
    .digest('hex');
}

/** @param value */
function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, sortJson(item)]),
    );
  }

  return value;
}
