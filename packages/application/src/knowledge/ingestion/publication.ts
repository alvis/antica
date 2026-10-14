import { createPageCitations } from './citation.js';
import { createSourceDraft } from './draft.js';
import { failure } from './failure.js';

import type { SourceVersion } from '@antica/domain';

import type {
  ClockPort,
  IdPort,
  JobStep,
  OperationResult,
  ParsedSourcePack,
  TransactionPort,
  UnitOfWork,
} from '../../ports/index.js';

import type { SourceParseBase } from './prepare.js';
import type { TextIndexOutcome } from './text-index.js';

/** inputs for atomic aggregate publication before either index writer runs */
export interface AggregatePublicationParams extends PublicationParams {
  readonly ids: IdPort;
}

/** inputs for completion after both index writers have returned */
export interface FinalPublicationParams extends PublicationParams {
  readonly base: SourceParseBase | null;
  readonly indexedText: TextIndexOutcome;
  readonly indexedImageCount: number;
}

/** inputs shared by the publication transactions for one parse run */
interface PublicationParams {
  readonly transaction: TransactionPort;
  readonly ownerId: string;
  readonly jobId: string;
  readonly versionId: string;
  readonly pageIds: readonly string[] | undefined;
  readonly pack: ParsedSourcePack;
  readonly clock: ClockPort;
}

/** private aggregate content transaction inputs */
interface SaveAggregateContentParams {
  readonly unit: UnitOfWork;
  readonly version: SourceVersion;
  readonly publication: AggregatePublicationParams;
}

/**
 * saves parsed rows, citations, optional draft, aggregate step and indexing job atomically
 * @param params active run, parsed pack and the existing owner transaction
 * @returns save outcome, including any active-run or checkpoint conflict
 */
export async function publishAggregate(
  params: AggregatePublicationParams,
): Promise<OperationResult<void>> {
  return params.transaction.run<OperationResult<void>>(
    params.ownerId,
    async (unit) => saveAggregate(unit, params),
  );
}

/**
 * completes the active version and job after indexing, in one final transaction
 * @param params fresh completion state, captured base and actual writer outcomes
 * @returns completion outcome; a failed result rolls back all final writes
 */
export async function publishFinal(
  params: FinalPublicationParams,
): Promise<OperationResult<void>> {
  return params.transaction.run<OperationResult<void>>(
    params.ownerId,
    async (unit) => saveFinal(unit, params),
  );
}

/**
 * holds the version row lock while saving canonical content and the indexing transition
 * @param unit existing aggregate publication transaction
 * @param params active run and canonical parsed pack
 * @returns the first aggregate save or CAS failure
 */
async function saveAggregate(
  unit: UnitOfWork,
  params: AggregatePublicationParams,
): Promise<OperationResult<void>> {
  const { jobId, versionId, pack, clock } = params;
  const job = await unit.jobs.get(jobId);
  const version = await unit.sources.getVersion(versionId);
  if (!job || !version) {
    return failure('NOT_FOUND', 'Source processing state not found');
  }
  if (version.activeParseRunId !== jobId) {
    return failure(
      'REVISION_CONFLICT',
      'A newer source parse superseded this job',
    );
  }
  // the version CAS holds its row lock through parse publication
  if (!(await unit.sources.updateVersion(version, version.status, jobId))) {
    return failure(
      'REVISION_CONFLICT',
      'A newer source parse superseded this job',
    );
  }
  await saveAggregateContent({ unit, version, publication: params });
  const step: JobStep = {
    jobId,
    step: 'parse:aggregate',
    revision: 1,
    state: 'completed',
    leaseUntil: null,
    checkpoint: null,
    result: pack,
  };
  if (!(await unit.jobs.updateStep(step, 0))) {
    return failure(
      'REVISION_CONFLICT',
      'Source parse aggregate changed during save',
    );
  }
  if (
    !(await unit.jobs.update(
      {
        ...job,
        state: { kind: 'running', stage: 'indexing' },
        updatedAt: clock.now(),
      },
      job.updatedAt,
    ))
  ) {
    return failure('REVISION_CONFLICT', 'Source job changed during parse save');
  }

  return { success: true, data: undefined };
}

/**
 * saves canonical rows, citations and the full-ingestion draft before checkpoint CAS
 * @param params existing transaction, locked version and parsed publication inputs
 */
async function saveAggregateContent(
  params: SaveAggregateContentParams,
): Promise<void> {
  const { unit, version, publication } = params;
  const { pack, pageIds, clock, ids } = publication;
  await unit.sources.saveParsed({ ...pack, mappings: [] });
  const citations = await createPageCitations({ unit, version, pack });
  if (!pageIds) {
    await createSourceDraft({ unit, version, pack, citations, clock, ids });
  }
}

/**
 * rereads the active run and commits mappings, version readiness and job together
 * @param unit existing final publication transaction
 * @param params captured base and both writer outcomes
 * @returns final CAS outcome that controls transaction rollback
 */
async function saveFinal(
  unit: UnitOfWork,
  params: FinalPublicationParams,
): Promise<OperationResult<void>> {
  const { jobId, versionId, pack, clock, indexedText } = params;
  const job = await unit.jobs.get(jobId);
  const version = await unit.sources.getVersion(versionId);
  if (!job || !version) {
    return failure('NOT_FOUND', 'Source processing state not found');
  }
  if (version.activeParseRunId !== jobId) {
    return failure(
      'REVISION_CONFLICT',
      'A newer source parse superseded this job',
    );
  }
  if (indexedText.kind === 'external' && indexedText.mappings.length) {
    await unit.sources.addProviderChunkMappings(
      indexedText.index,
      indexedText.mappings,
    );
  }
  const { textReady, imageReady } = calculateReadiness(params);
  const partial = !textReady || !imageReady;
  const updated: SourceVersion = {
    ...version,
    status: partial ? 'partial' : 'ready',
    textIndexStatus: textReady ? 'ready' : 'partial',
    imageIndexStatus: imageReady ? 'ready' : 'partial',
    activeParseRunId: jobId,
  };
  if (!(await unit.sources.updateVersion(updated, version.status, jobId))) {
    return failure(
      'REVISION_CONFLICT',
      'Source version changed during indexing',
    );
  }
  const now = clock.now();
  const state = partial
    ? {
        kind: 'partial' as const,
        completedAt: now,
        incompleteStages: [
          !textReady ? 'text_index' : '',
          !imageReady ? 'image_index' : '',
        ].filter(Boolean),
      }
    : { kind: 'succeeded' as const, completedAt: now };
  if (
    !(await unit.jobs.update(
      { ...job, state, updatedAt: now, result: pack },
      job.updatedAt,
    ))
  ) {
    return failure('REVISION_CONFLICT', 'Source job changed during completion');
  }

  return { success: true, data: undefined };
}

/**
 * applies the original readiness rules to the immutable base and current writer counts
 * @param params selected pages, base statuses, parsed content and writer counts
 * @returns independent text and image readiness decisions
 */
function calculateReadiness(params: FinalPublicationParams): {
  readonly textReady: boolean;
  readonly imageReady: boolean;
} {
  const { pageIds, base, pack, indexedText, indexedImageCount } = params;
  const selectedPageIds = new Set(pageIds ?? []);
  const baseComplete =
    !base ||
    base.pages.every(
      (page) => page.parseRunId !== null || selectedPageIds.has(page.pageId),
    );
  const textReady =
    indexedText.indexedCount >=
      pack.pages.filter((page) => page.rawText.trim()).length &&
    pack.warnings.length === 0 &&
    baseComplete &&
    (!base || base.textIndexStatus === 'ready');
  const imageReady =
    indexedImageCount >= pack.images.length &&
    pack.warnings.length === 0 &&
    baseComplete &&
    (!base || base.imageIndexStatus === 'ready');

  return { textReady, imageReady };
}
