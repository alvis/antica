import { failure } from './failure.js';

import type { SourceDetail } from '@antica/contracts';

import type {
  OperationResult,
  SourceReadTarget,
  TransactionPort,
} from '../../ports/index.js';

import type {
  SourceGetParams,
  SourceReadSigningPort,
  SourceService,
} from '../ingestion.js';

/** inputs for owner-scoped detail retrieval and optional target signing */
export interface SourceDetailParams {
  readonly transaction: TransactionPort;
  readonly signer: SourceReadSigningPort | undefined;
}

const sourcePageDefaultLimit = 20;

/**
 * reads source detail in the authenticated transaction and signs selected targets afterward
 * @param params source transaction and optional media signer
 * @returns detail operation preserving page/cursor selection and read URLs
 */
export function createGetOperation(
  params: SourceDetailParams,
): SourceService['get'] {
  const { transaction, signer } = params;

  return async (
    selection: SourceGetParams,
  ): Promise<OperationResult<SourceDetail>> => {
    const { ownerId, id, versionId, pageId, cursor, limit } = selection;
    const found = await transaction.run<
      OperationResult<{
        readonly detail: SourceDetail;
        readonly targets: readonly SourceReadTarget[];
      }>
    >(ownerId, async (unit) => {
      if (pageId && cursor) {
        return failure(
          'VALIDATION_FAILED',
          'Page locator and page cursor cannot be combined',
        );
      }
      const detail = await unit.sources.get(
        id,
        versionId,
        pageId,
        cursor,
        limit ?? sourcePageDefaultLimit,
      );
      if (!detail || (pageId && detail.pages.items.length === 0)) {
        return failure('NOT_FOUND', 'Source or selected page not found');
      }
      const selectedPageIds = detail.pages.items.map((page) => page.id);
      const targets = signer
        ? await unit.sources.getReadTargets(
            detail.version.id,
            selectedPageIds.length ? selectedPageIds : undefined,
          )
        : [];

      return { success: true, data: { detail, targets } };
    });
    if (!found.success) {
      return found;
    }
    if (!signer) {
      return { success: true, data: found.data.detail };
    }
    const reads = await Promise.all(
      found.data.targets.map(async (target) => {
        const signed = await signer.signRead(target.storageKey);

        return {
          assetOrDerivativeId: target.assetOrDerivativeId,
          url: signed.url,
          expiresAt: signed.expiresAt,
        };
      }),
    );

    return { success: true, data: { ...found.data.detail, reads } };
  };
}
