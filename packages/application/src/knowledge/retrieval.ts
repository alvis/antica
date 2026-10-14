import type {
  ImageCompareRequest,
  ImageComparisonResult,
  ImageSearchRequest,
  ImageSearchResult,
} from '@antica/contracts';

import type {
  ClockPort,
  IdPort,
  ImageRetrievalPort,
  IndexIdentity,
  OperationResult,
  TransactionPort,
  UnitOfWork,
} from '../ports/index.js';

/** authenticated visual search over one compatible image index */
export interface ImageSearchService {
  query(
    ownerId: string,
    input: ImageSearchRequest | ImageCompareRequest,
  ): Promise<OperationResult<ImageSearchResult | ImageComparisonResult>>;
}

/** dependencies for owner-checked visual search and comparison auditing */
export interface ImageSearchParams {
  readonly transaction: TransactionPort;
  readonly images: ImageRetrievalPort;
  readonly index: IndexIdentity;
  readonly clock: ClockPort;
  readonly ids: IdPort;
}

/**
 * creates owner-checked image retrieval with durable comparison receipts
 * @param params transaction, retrieval, index, clock and identifier ports
 * @returns image search service bound to those ports
 */
export function createImageSearchService(
  params: ImageSearchParams,
): ImageSearchService {
  return {
    query: async (ownerId, input) => queryImages(params, ownerId, input),
  };
}

/**
 * authorizes a query before passing it to the compatible index
 * @param params image retrieval dependencies
 * @param ownerId authenticated collector identifier
 * @param input search or comparison request
 * @returns image matches or a saved comparison envelope
 */
async function queryImages(
  params: ImageSearchParams,
  ownerId: string,
  input: ImageSearchRequest | ImageCompareRequest,
): Promise<OperationResult<ImageSearchResult | ImageComparisonResult>> {
  const authorized = await params.transaction.run<OperationResult<void>>(
    ownerId,
    async (unit) => authorizeQuery(unit, input),
  );
  if (!authorized.success) {
    return authorized;
  }

  return input.mode === 'search'
    ? params.images.search(input, params.index)
    : compareImages(params, ownerId, input);
}

/**
 * checks that the query and selected comparison image belong to the collector
 * @param unit owner-scoped repositories
 * @param input search or comparison request
 * @returns success only for available image identities
 */
async function authorizeQuery(
  unit: UnitOfWork,
  input: ImageSearchRequest | ImageCompareRequest,
): Promise<OperationResult<void>> {
  const anchor = await unit.evidence.getAnchor(input.queryAnchorId);
  if (!anchor || !(await unit.records.get(anchor.recordId))) {
    return unavailable(
      'EVIDENCE_INVALID',
      'Query image is not available to this collector',
    );
  }

  return input.mode === 'compare'
    ? authorizeSelectedImage(unit, input)
    : { success: true, data: undefined };
}

/**
 * resolves the exact comparison target before model execution
 * @param unit owner-scoped repositories
 * @param input requested comparison pair
 * @returns success only when the selected image is saved and visible
 */
async function authorizeSelectedImage(
  unit: UnitOfWork,
  input: ImageCompareRequest,
): Promise<OperationResult<void>> {
  if (input.selected.kind === 'collection') {
    const record = await unit.records.get(input.selected.recordId);
    const media = await unit.media.get(input.selected.originalAssetId);

    return record &&
      media?.owner.kind === 'record' &&
      media.owner.recordId === record.id
      ? { success: true, data: undefined }
      : unavailable(
          'EVIDENCE_INVALID',
          'Selected collection image is unavailable',
        );
  }

  const selected = input.selected;
  const version = await unit.sources.getVersion(selected.sourceVersionId);
  const detail = version
    ? await unit.sources.get(version.sourceId, version.id)
    : null;

  return detail?.referenceImages.some(
    (image) => image.id === selected.referenceImageId,
  )
    ? { success: true, data: undefined }
    : unavailable('SOURCE_UNAVAILABLE', 'Selected source image is unavailable');
}

/**
 * saves the actual comparison envelope or rejected-output audit before replying
 * @param params comparison and persistence dependencies
 * @param ownerId authenticated collector identifier
 * @param input authorized comparison request
 * @returns saved comparison envelope or provider error
 */
async function compareImages(
  params: ImageSearchParams,
  ownerId: string,
  input: ImageCompareRequest,
): Promise<OperationResult<ImageComparisonResult>> {
  const compared = await params.images.compare(input, params.index);
  if (!compared.success) {
    const recorded = await params.transaction.run<OperationResult<void>>(
      ownerId,
      async (unit) => {
        await unit.comparisons.recordFailure({
          id: params.ids.create(),
          query: input,
          error: compared.error,
          audit: compared.audit,
          createdAt: params.clock.now(),
        });

        return { success: true, data: undefined };
      },
    );
    if (!recorded.success) {
      return recorded;
    }

    return { success: false, error: compared.error, cause: compared.cause };
  }

  const saved = await params.transaction.run<OperationResult<void>>(
    ownerId,
    async (unit) => {
      await unit.comparisons.save(compared.data);

      return { success: true, data: undefined };
    },
  );
  if (!saved.success) {
    return saved;
  }

  return { success: true, data: compared.data };
}

/**
 * constructs a nonretryable owner-bound image lookup error
 * @param code unavailable source or evidence category
 * @param message safe user-facing explanation
 * @returns failed operation result
 */
function unavailable(
  code: 'EVIDENCE_INVALID' | 'SOURCE_UNAVAILABLE',
  message: string,
): OperationResult<never> {
  return { success: false, error: { code, message, retryable: false } };
}
