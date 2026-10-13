import { createHash } from 'node:crypto';

import { requestFingerprint } from './receipt.js';

import type {
  SourceAccepted,
  SourceCommand,
  SourceDetail,
} from '@antica/contracts';
import type {
  KnowledgeEntry,
  Source,
  SourceCitation,
  SourceVersion,
} from '@antica/domain';

import type {
  CanonicalTextChunk,
  ClockPort,
  DurableSourceParsingPort,
  DurableTextIndexWriterPort,
  IdPort,
  IndexIdentity,
  JobStep,
  OperationResult,
  ParsedSourcePack,
  ProviderChunkMapping,
  SourceReadTarget,
  SourceParsingHandle,
  SourceParsingPort,
  TextIndexHandle,
  TextIndexWriterPort,
  TransactionPort,
  UnitOfWork,
} from '../ports/index.js';

/** source commands and reads within the authenticated collector boundary */
export interface SourceService {
  submit(
    ownerId: string,
    command: SourceCommand,
  ): Promise<OperationResult<SourceAccepted>>;
  get(
    ownerId: string,
    id: string,
    versionId?: string,
    pageId?: string,
    cursor?: string,
    limit?: number,
  ): Promise<OperationResult<SourceDetail>>;
}

/** Signs a real source media object after its owner and version are resolved. */
export interface SourceReadSigningPort {
  signRead(
    storageKey: string,
  ): Promise<{ readonly url: string; readonly expiresAt: string }>;
}

/** indexes parsed reference images after their canonical database rows commit */
export interface SourceImageIndexPort {
  index(
    ownerId: string,
    pack: ParsedSourcePack,
  ): Promise<OperationResult<{ readonly indexedCount: number }>>;
}

/** selects honest readiness for local or externally persisted retrieval indexes */
export interface SourceIndexingParams {
  readonly text:
    | { readonly kind: 'local' }
    | {
        readonly kind: 'external';
        readonly index: IndexIdentity;
        readonly writer: TextIndexWriterPort | DurableTextIndexWriterPort;
      };
  readonly image:
    | { readonly kind: 'local' }
    | { readonly kind: 'external'; readonly writer: SourceImageIndexPort };
}

/**
 * creates persistent source intake operations
 * @param transaction collector-scoped unit of work
 * @param clock server clock
 * @param ids server identifier generator
 * @param signer optional short-lived media read signer for source detail
 * @returns intake operations bound to the collector's transaction
 */
export function createSourceService(
  transaction: TransactionPort,
  clock: ClockPort,
  ids: IdPort,
  signer?: SourceReadSigningPort,
): SourceService {
  return {
    submit: async (ownerId, command) =>
      transaction.run<OperationResult<SourceAccepted>>(
        ownerId,
        async (unit) => {
          const fingerprint = requestFingerprint(command);
          const prior = await unit.commands.get(
            ownerId,
            'sources.submit',
            command.requestKey,
          );
          if (prior) {
            return prior.fingerprint === fingerprint
              ? { success: true, data: prior.result as SourceAccepted }
              : failure(
                  'VALIDATION_FAILED',
                  'Idempotency key was used for a different source command',
                );
          }

          if (command.mode === 'reprocess') {
            const version = await unit.sources.getVersion(
              command.sourceVersionId,
            );
            if (!version) {
              return failure('NOT_FOUND', 'Source version not found');
            }
            const source = await unit.sources.get(version.sourceId, version.id);
            if (!source) {
              return failure('NOT_FOUND', 'Source not found');
            }
            if (
              command.pageIds.length === 0 ||
              new Set(command.pageIds).size !== command.pageIds.length
            ) {
              return failure(
                'VALIDATION_FAILED',
                'Select distinct pages to reprocess',
              );
            }
            for (const pageId of command.pageIds) {
              const page = await unit.sources.getPage(pageId);
              if (!page || page.sourceVersionId !== version.id) {
                return failure(
                  'SOURCE_UNAVAILABLE',
                  'Selected page does not belong to the source version',
                );
              }
            }
            const jobId = ids.create();
            const now = clock.now();
            const accepted = {
              sourceId: version.sourceId,
              sourceVersionId: version.id,
              jobId,
            };
            await unit.jobs.create({
              id: jobId,
              kind: 'sourceIngestion',
              resourceId: version.id,
              state: { kind: 'queued' },
              createdAt: now,
              updatedAt: now,
              result: { pageIds: command.pageIds },
            });
            await unit.outbox.enqueue({
              id: ids.create(),
              name: 'sourceIngestion',
              event: {
                eventId: ids.create(),
                schemaVersion: '1',
                jobId,
                resourceId: version.id,
                ownerId,
                idempotencyKey: command.requestKey,
              },
              createdAt: now,
              sentAt: null,
            });
            await unit.commands.insert({
              ownerId,
              operation: 'sources.submit',
              requestKey: command.requestKey,
              fingerprint,
              status: 202,
              result: accepted,
            });

            return { success: true, data: accepted };
          }

          const registration = command.registration;
          const ordered = [...registration.assets].sort(
            (left, right) => left.order - right.order,
          );
          if (
            ordered.length === 0 ||
            ordered.some((asset, index) => asset.order !== index) ||
            new Set(ordered.map((asset) => asset.assetId)).size !==
              ordered.length
          ) {
            return failure(
              'VALIDATION_FAILED',
              'Source pages need a unique contiguous order',
            );
          }
          if (registration.kind === 'book_pdf' && ordered.length !== 1) {
            return failure(
              'VALIDATION_FAILED',
              'A PDF source needs exactly one PDF asset',
            );
          }
          if (
            registration.metadata.authorStatus === 'unknown' &&
            registration.metadata.contributors.some(
              (contributor) => contributor.role === 'author',
            )
          ) {
            return failure(
              'VALIDATION_FAILED',
              'Unknown author cannot have a named author attribution',
            );
          }
          const media = await Promise.all(
            ordered.map(async (asset) => unit.media.get(asset.assetId)),
          );
          for (const asset of media) {
            if (
              !asset ||
              asset.owner.kind !== 'source_intake' ||
              asset.owner.intakeKey !== registration.intakeKey
            ) {
              return failure(
                'FORBIDDEN',
                'Source asset does not belong to this intake',
              );
            }
            if (asset.state !== 'ready') {
              return failure(
                'UPLOAD_INCOMPLETE',
                'Source asset upload is incomplete',
              );
            }
            if (
              registration.kind === 'book_pdf' &&
              (asset.purpose !== 'book_file' ||
                asset.mimeType !== 'application/pdf')
            ) {
              return failure(
                'MEDIA_UNSUPPORTED',
                'PDF source requires a PDF book file',
              );
            }
            if (
              registration.kind === 'book_pages' &&
              (asset.purpose !== 'book_page' ||
                ![
                  'image/jpeg',
                  'image/png',
                  'image/webp',
                  'image/tiff',
                ].includes(asset.mimeType))
            ) {
              return failure(
                'MEDIA_UNSUPPORTED',
                'Book pages require supported image assets',
              );
            }
          }
          const sourceHash = createHash('sha256')
            .update(
              JSON.stringify({
                kind: registration.kind,
                assets: ordered.map((asset, index) => ({
                  checksum: media[index]?.sha256,
                  printedPageLabel: asset.printedPageLabel,
                  presentation: asset.presentation ?? null,
                })),
              }),
            )
            .digest('hex');
          const duplicate = await unit.sources.findVersionByHash(sourceHash);
          if (duplicate) {
            const jobId = await unit.sources.getIngestionJobId(duplicate.id);
            if (!jobId) {
              return failure(
                'SOURCE_UNAVAILABLE',
                'Existing source job is unavailable',
              );
            }
            const accepted = {
              sourceId: duplicate.sourceId,
              sourceVersionId: duplicate.id,
              jobId,
            };
            await unit.commands.insert({
              ownerId,
              operation: 'sources.submit',
              requestKey: command.requestKey,
              fingerprint,
              status: 202,
              result: accepted,
            });

            return { success: true, data: accepted };
          }
          const existing = registration.existingSourceId
            ? await unit.sources.get(registration.existingSourceId)
            : null;
          if (registration.existingSourceId && !existing) {
            return failure('NOT_FOUND', 'Source not found');
          }
          if (
            existing &&
            (existing.source.kind !== registration.kind ||
              existing.source.revision !== registration.expectedRevision)
          ) {
            return failure(
              'REVISION_CONFLICT',
              'Source changed since it was opened',
            );
          }
          const now = clock.now();
          const sourceId = existing?.source.id ?? ids.create();
          const sourceVersionId = ids.create();
          const jobId = ids.create();
          const version: SourceVersion = {
            id: sourceVersionId,
            sourceId,
            originalAssetIds: ordered.map((asset) => asset.assetId),
            sourceHash,
            metadataSnapshot: registration.metadata,
            capturedAt: now,
            retrievedAt: null,
            status: 'registered',
            textIndexStatus: 'registered',
            imageIndexStatus: 'registered',
            activeParseRunId: null,
          };
          if (existing) {
            const changed = await unit.sources.addVersion(
              version,
              existing.source.revision,
              ordered,
            );
            if (!changed) {
              return failure(
                'REVISION_CONFLICT',
                'Source changed during registration',
              );
            }
          } else {
            const source: Source = {
              id: sourceId,
              revision: 1,
              createdAt: now,
              updatedAt: now,
              kind: registration.kind,
              metadata: registration.metadata,
              currentVersionId: sourceVersionId,
            };
            await unit.sources.create(source, version, ordered);
          }
          await unit.jobs.create({
            id: jobId,
            kind: 'sourceIngestion',
            resourceId: sourceVersionId,
            state: { kind: 'queued' },
            createdAt: now,
            updatedAt: now,
            result: null,
          });
          await unit.outbox.enqueue({
            id: ids.create(),
            name: 'sourceIngestion',
            event: {
              eventId: ids.create(),
              schemaVersion: '1',
              jobId,
              resourceId: sourceVersionId,
              ownerId,
              idempotencyKey: command.requestKey,
            },
            createdAt: now,
            sentAt: null,
          });
          const accepted = { sourceId, sourceVersionId, jobId };
          await unit.commands.insert({
            ownerId,
            operation: 'sources.submit',
            requestKey: command.requestKey,
            fingerprint,
            status: 202,
            result: accepted,
          });

          return { success: true, data: accepted };
        },
      ),
    get: async (ownerId, id, versionId, pageId, cursor, limit) => {
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
          limit ?? 20,
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
    },
  };
}

/**
 * processes a previously authorized source job outside the intake request
 * @param transaction collector-scoped unit of work
 * @param parser original-byte parser
 * @param clock server clock
 * @param ids server identifier generator
 * @param indexing local or externally persisted text and image indexes
 * @returns resumable worker bound to the configured parser and indexes
 */
export function createSourceIngestionHandler(
  transaction: TransactionPort,
  parser: SourceParsingPort | DurableSourceParsingPort,
  clock: ClockPort,
  ids: IdPort,
  indexing: SourceIndexingParams = {
    text: { kind: 'local' },
    image: { kind: 'local' },
  },
): (ownerId: string, jobId: string) => Promise<OperationResult<void>> {
  return async (ownerId, jobId) => {
    const prepared = await transaction.run<
      OperationResult<{
        readonly version: SourceVersion;
        readonly pageIds: readonly string[] | undefined;
        readonly done: boolean;
      }>
    >(ownerId, async (unit) => {
      const job = await unit.jobs.get(jobId);
      if (!job || job.kind !== 'sourceIngestion') {
        return failure('NOT_FOUND', 'Source job not found');
      }
      const version = await unit.sources.getVersion(job.resourceId);
      if (!version) {
        return failure('NOT_FOUND', 'Source version not found');
      }
      const source = await unit.sources.get(version.sourceId, version.id);
      if (!source) {
        return failure('NOT_FOUND', 'Source not found');
      }
      const pageIds =
        job.result &&
        typeof job.result === 'object' &&
        'pageIds' in job.result &&
        Array.isArray(job.result.pageIds)
          ? job.result.pageIds.filter(
              (id): id is string => typeof id === 'string',
            )
          : undefined;
      if (job.state.kind === 'succeeded' || job.state.kind === 'partial') {
        return { success: true, data: { version, pageIds, done: true } };
      }
      const now = clock.now();
      const processing: SourceVersion = {
        ...version,
        status: 'processing',
        textIndexStatus:
          version.textIndexStatus === 'registered'
            ? 'processing'
            : version.textIndexStatus,
        imageIndexStatus:
          version.imageIndexStatus === 'registered'
            ? 'processing'
            : version.imageIndexStatus,
        activeParseRunId: jobId,
      };
      if (
        !(await unit.sources.updateVersion(
          processing,
          version.status,
          version.activeParseRunId,
        ))
      ) {
        return failure(
          'REVISION_CONFLICT',
          'Source version changed during processing',
        );
      }
      const started = await unit.jobs.update(
        {
          ...job,
          state: { kind: 'running', stage: 'parsing' },
          updatedAt: now,
        },
        job.updatedAt,
      );
      if (!started) {
        return failure(
          'REVISION_CONFLICT',
          'Source job changed during processing',
        );
      }

      return {
        success: true,
        data: { version: processing, pageIds, done: false },
      };
    });
    if (!prepared.success) {
      return prepared;
    }
    if (prepared.data.done) {
      return { success: true, data: undefined };
    }
    const aggregate = await transaction.run<OperationResult<JobStep | null>>(
      ownerId,
      async (unit) => ({
        success: true,
        data: await unit.jobs.getStep(jobId, 'parse:aggregate'),
      }),
    );
    if (!aggregate.success) {
      return aggregate;
    }
    const savedPack =
      aggregate.data?.state === 'completed' &&
      isParsedSourcePack(aggregate.data.result)
        ? aggregate.data.result
        : null;
    const parsed: OperationResult<ParsedSourcePack | null> = savedPack
      ? { success: true, data: savedPack }
      : 'parse' in parser
        ? await parser.parse({
            sourceVersionId: prepared.data.version.id,
            parseRunId: jobId,
            originalAssetIds: prepared.data.version.originalAssetIds,
            pageIds: prepared.data.pageIds,
          })
        : await parseDurably(
            transaction,
            parser,
            clock,
            ownerId,
            jobId,
            prepared.data.version,
          );
    if (!parsed.success) {
      const recorded = await transaction.run<OperationResult<void>>(
        ownerId,
        async (unit) => {
          const job = await unit.jobs.get(jobId);
          if (!job) {
            return failure('NOT_FOUND', 'Source job not found');
          }
          if (
            !(await unit.jobs.update(
              {
                ...job,
                state: {
                  kind: 'failed',
                  error: { ...parsed.error, requestId: ids.create() },
                },
                updatedAt: clock.now(),
              },
              job.updatedAt,
            ))
          ) {
            return failure(
              'REVISION_CONFLICT',
              'Source job changed during failure save',
            );
          }
          const version = await unit.sources.getVersion(job.resourceId);
          if (!version) {
            return failure('NOT_FOUND', 'Source version not found');
          }
          if (
            version.status !== 'processing' ||
            version.activeParseRunId !== jobId ||
            !(await unit.sources.updateVersion(
              {
                ...version,
                status: 'failed',
                textIndexStatus: 'failed',
                imageIndexStatus: 'failed',
              },
              'processing',
              jobId,
            ))
          ) {
            return failure(
              'REVISION_CONFLICT',
              'Source version changed during failure save',
            );
          }

          return { success: true, data: undefined };
        },
      );
      if (!recorded.success) {
        return recorded;
      }

      return { success: false, error: parsed.error, cause: parsed.cause };
    }
    if (!parsed.data) {
      return { success: true, data: undefined };
    }
    const pack = prepared.data.pageIds
      ? selectParsedPages(parsed.data, prepared.data.pageIds)
      : parsed.data;
    if (!pack) {
      return failure(
        'SOURCE_UNAVAILABLE',
        'Selected pages were not found in the parsed source version',
      );
    }
    if (!savedPack) {
      const stored = await transaction.run<OperationResult<void>>(
        ownerId,
        async (unit) => {
          const job = await unit.jobs.get(jobId);
          const version = await unit.sources.getVersion(
            prepared.data.version.id,
          );
          if (!job || !version) {
            return failure('NOT_FOUND', 'Source processing state not found');
          }
          if (version.activeParseRunId !== jobId) {
            return failure(
              'REVISION_CONFLICT',
              'A newer source parse superseded this job',
            );
          }
          await unit.sources.saveParsed({ ...pack, mappings: [] });
          const citations = await createPageCitations(unit, version, pack);
          if (!prepared.data.pageIds) {
            await createSourceDraft(unit, version, pack, citations, clock, ids);
          }
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
            return failure(
              'REVISION_CONFLICT',
              'Source job changed during parse save',
            );
          }

          return { success: true, data: undefined };
        },
      );
      if (!stored.success) {
        return stored;
      }
    }
    const textResult = await indexText(
      transaction,
      indexing.text,
      ownerId,
      jobId,
      pack,
      clock,
    );
    if (!textResult.success) {
      return textResult;
    }
    if (!textResult.data) {
      return { success: true, data: undefined };
    }
    const indexedText = textResult.data;
    const imageResult =
      indexing.image.kind === 'local'
        ? { success: true as const, data: { indexedCount: pack.images.length } }
        : await indexing.image.writer.index(ownerId, pack);
    if (!imageResult.success) {
      return imageResult;
    }

    return transaction.run<OperationResult<void>>(ownerId, async (unit) => {
      const job = await unit.jobs.get(jobId);
      const version = await unit.sources.getVersion(prepared.data.version.id);
      if (!job || !version) {
        return failure('NOT_FOUND', 'Source processing state not found');
      }
      if (version.activeParseRunId !== jobId) {
        return failure(
          'REVISION_CONFLICT',
          'A newer source parse superseded this job',
        );
      }
      if (indexedText.mappings.length) {
        if (indexing.text.kind !== 'external') {
          return failure(
            'VALIDATION_FAILED',
            'Local text indexing cannot produce provider chunk mappings',
          );
        }
        await unit.sources.addProviderChunkMappings(
          indexing.text.index,
          indexedText.mappings,
        );
      }
      const textReady =
        indexedText.indexedCount >=
          pack.pages.filter((page) => page.rawText.trim()).length &&
        pack.warnings.length === 0;
      const imageReady =
        imageResult.data.indexedCount >= pack.images.length &&
        pack.warnings.length === 0;
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
        return failure(
          'REVISION_CONFLICT',
          'Source job changed during completion',
        );
      }

      return { success: true, data: undefined };
    });
  };
}

/**
 * Resumes each original asset from its saved provider checkpoint and combines the results.
 * @param transaction owner-scoped transaction port
 * @param parser durable original-byte parser
 * @param clock timestamp source for job updates
 * @param ownerId authenticated collector identifier
 * @param jobId active source ingestion job identifier
 * @param version registered source version and original asset order
 * @returns parsed pack, or null while an asset is still pending
 */
async function parseDurably(
  transaction: TransactionPort,
  parser: DurableSourceParsingPort,
  clock: ClockPort,
  ownerId: string,
  jobId: string,
  version: SourceVersion,
): Promise<OperationResult<ParsedSourcePack | null>> {
  const packs: ParsedSourcePack[] = [];
  for (const assetId of version.originalAssetIds) {
    const stepName = `parse:${assetId}`;
    const current = await transaction.run<
      OperationResult<{ readonly step: JobStep | null }>
    >(ownerId, async (unit) => ({
      success: true,
      data: { step: await unit.jobs.getStep(jobId, stepName) },
    }));
    if (!current.success) {
      return current;
    }
    const step = current.data.step;
    if (step?.state === 'completed') {
      if (!isParsedSourcePack(step.result)) {
        return failure(
          'SOURCE_UNAVAILABLE',
          'Saved parse result is unavailable',
        );
      }
      packs.push(step.result);
      continue;
    }
    const handle =
      step?.state === 'waiting' && isParsingHandle(step.checkpoint)
        ? step.checkpoint
        : null;
    const progress = handle
      ? await parser.resume(handle)
      : await parser.submit({
          sourceVersionId: version.id,
          parseRunId: jobId,
          originalAssetId: assetId,
        });
    if (!progress.success) {
      return progress;
    }
    const nextStep = {
      jobId,
      step: stepName,
      revision: (step?.revision ?? 0) + 1,
      state:
        progress.data.kind === 'waiting'
          ? ('waiting' as const)
          : ('completed' as const),
      leaseUntil:
        progress.data.kind === 'waiting'
          ? (progress.data.resumeAfter ?? null)
          : null,
      checkpoint:
        progress.data.kind === 'waiting'
          ? {
              sourceVersionId: progress.data.sourceVersionId,
              parseRunId: progress.data.parseRunId,
              originalAssetId: progress.data.originalAssetId,
              provider: progress.data.provider,
              providerJobId: progress.data.providerJobId,
            }
          : null,
      result: progress.data.kind === 'completed' ? progress.data.pack : null,
    };
    const persisted = await transaction.run<OperationResult<void>>(
      ownerId,
      async (unit) => {
        if (!(await unit.jobs.updateStep(nextStep, step?.revision ?? 0))) {
          return failure(
            'REVISION_CONFLICT',
            'Source parse step changed concurrently',
          );
        }
        const job = await unit.jobs.get(jobId);
        if (!job) {
          return failure('NOT_FOUND', 'Source job not found');
        }
        const state =
          progress.data.kind === 'waiting'
            ? {
                kind: 'waiting' as const,
                stage: 'parsing',
                resumeAfter: progress.data.resumeAfter,
              }
            : { kind: 'running' as const, stage: 'parsing' };
        if (
          !(await unit.jobs.update(
            { ...job, state, updatedAt: clock.now() },
            job.updatedAt,
          ))
        ) {
          return failure(
            'REVISION_CONFLICT',
            'Source job changed during checkpoint',
          );
        }
        if (progress.data.kind === 'waiting' && !handle) {
          await unit.jobs.mapProviderJob(
            progress.data.provider,
            progress.data.providerJobId,
            jobId,
            stepName,
          );
        }

        return { success: true, data: undefined };
      },
    );
    if (!persisted.success) {
      return persisted;
    }
    if (progress.data.kind === 'waiting') {
      return { success: true, data: null };
    }
    packs.push(progress.data.pack);
  }
  const pages = packs
    .flatMap((pack) => pack.pages)
    .map((page, pageIndex) => ({ ...page, pageIndex }));
  const pageIndexes = new Map(pages.map((page) => [page.id, page.pageIndex]));
  const images = packs
    .flatMap((pack) => pack.images)
    .map((image) =>
      image.locator.kind === 'page'
        ? {
            ...image,
            locator: {
              ...image.locator,
              pageIndex:
                pageIndexes.get(image.locator.pageId) ??
                image.locator.pageIndex,
            },
          }
        : image,
    );

  return {
    success: true,
    data: {
      sourceVersionId: version.id,
      parseRunId: jobId,
      rawOutputAssetId: packs[0]!.rawOutputAssetId,
      pages,
      regions: packs.flatMap((pack) => pack.regions),
      images,
      warnings: packs.flatMap((pack) => pack.warnings),
    },
  };
}

/**
 * Persists one stable citation for every page with extracted text.
 * @param unit owner-scoped repositories
 * @param version source identity for every locator
 * @param pack parsed canonical pages
 * @returns citations linked to the canonical pages
 */
async function createPageCitations(
  unit: UnitOfWork,
  version: SourceVersion,
  pack: ParsedSourcePack,
): Promise<readonly SourceCitation[]> {
  const citations = pack.pages
    .filter((page) => page.rawText.trim())
    .map((page): SourceCitation => ({
      id: stableCitationId(page.id),
      locator: {
        kind: 'page',
        sourceId: version.sourceId,
        sourceVersionId: version.id,
        pageId: page.id,
        pageIndex: page.pageIndex,
        printedPageLabel: page.printedPageLabel,
        canonicalViewId: page.view.id,
        regionId: null,
        region: null,
        textRange: null,
      },
      relation: 'background',
      availability: 'stored',
      verification: page.quality === 'usable' ? 'located' : 'needs_review',
    }));
  for (const citation of citations) {
    if (!(await unit.sources.getCitation(citation.id))) {
      await unit.sources.addCitation(citation);
    }
  }

  return citations;
}

/**
 * Seeds an unsaved knowledge draft from real page text for collector review.
 * @param unit owner-scoped repositories
 * @param version source metadata and version identity
 * @param pack extracted text and reference image identifiers
 * @param citations persisted page citations
 * @param clock timestamp source for the draft
 * @param ids identifier generator for the entry
 */
async function createSourceDraft(
  unit: UnitOfWork,
  version: SourceVersion,
  pack: ParsedSourcePack,
  citations: readonly SourceCitation[],
  clock: ClockPort,
  ids: IdPort,
): Promise<void> {
  const existing = await unit.sources.get(version.sourceId, version.id);
  if (existing?.knowledgeDraftIds.length) {
    return;
  }
  const page = pack.pages.find((candidate) => candidate.rawText.trim());
  const firstCitation = page
    ? citations.find(
        (citation) =>
          citation.locator.kind === 'page' &&
          citation.locator.pageId === page.id,
      )
    : null;
  const now = clock.now();
  const entryId = ids.create();
  const entry: KnowledgeEntry = {
    id: entryId,
    revision: 1,
    createdAt: now,
    updatedAt: now,
    displayCode: await unit.knowledge.allocateCode(),
    status: 'draft',
    savedBy: null,
    methodIds: [],
    content: {
      titleZhHant: version.metadataSnapshot.title,
      aliases: [],
      kinds: ['other'],
      otherKindLabel: '來源摘錄',
      summary: {
        textZhHant: '來源已匯入，請核對原頁並補充知識內容。',
        citationIds: [],
        support: 'needs_source',
      },
      history:
        page && firstCitation
          ? [
              {
                textZhHant: `原文摘錄：${page.rawText.slice(0, 500)}`,
                citationIds: [firstCitation.id],
                support:
                  firstCitation.verification === 'located'
                    ? 'cited'
                    : 'needs_source',
              },
            ]
          : [],
      features: [],
      applicability: [],
      exampleReferenceImageIds: pack.images.map((image) => image.id),
      relatedEntryIds: [],
      citations,
    },
  };
  await unit.knowledge.create(entry);
  await unit.sources.linkKnowledgeDraft(version.id, entryId);
}

/**
 * Indexes canonical page text or resumes a durable external index checkpoint.
 * @param transaction owner-scoped transaction port
 * @param config local index or external writer configuration
 * @param ownerId authenticated collector identifier
 * @param jobId active ingestion job identifier
 * @param pack parsed canonical pages and regions
 * @param clock timestamp source for checkpoint updates
 * @returns indexed count and provider mappings, or null while pending
 */
async function indexText(
  transaction: TransactionPort,
  config: SourceIndexingParams['text'],
  ownerId: string,
  jobId: string,
  pack: ParsedSourcePack,
  clock: ClockPort,
): Promise<
  OperationResult<{
    readonly indexedCount: number;
    readonly mappings: readonly ProviderChunkMapping[];
  } | null>
> {
  const chunks: CanonicalTextChunk[] = pack.pages
    .filter((page) => page.rawText.trim())
    .map((page) => ({
      sourceVersionId: pack.sourceVersionId,
      parseRunId: pack.parseRunId,
      citationId: stableCitationId(page.id),
      canonicalRegionIds: page.regionIds,
      contentAsRetrieved: page.rawText,
    }));
  if (config.kind === 'local') {
    return {
      success: true,
      data: { indexedCount: chunks.length, mappings: [] },
    };
  }
  if ('indexSource' in config.writer) {
    const indexed = await config.writer.indexSource({
      index: config.index,
      sourceVersionId: pack.sourceVersionId,
      chunks,
    });

    return indexed.success ? { success: true, data: indexed.data } : indexed;
  }
  const current = await transaction.run<OperationResult<JobStep | null>>(
    ownerId,
    async (unit) => ({
      success: true,
      data: await unit.jobs.getStep(jobId, 'index:text'),
    }),
  );
  if (!current.success) {
    return current;
  }
  const step = current.data;
  if (step?.state === 'completed' && isTextIndexResult(step.result)) {
    return { success: true, data: step.result };
  }
  const handle =
    step?.state === 'waiting' && isTextIndexHandle(step.checkpoint)
      ? step.checkpoint
      : null;
  const progress = handle
    ? await config.writer.resume(handle)
    : await config.writer.submit({
        index: config.index,
        sourceVersionId: pack.sourceVersionId,
        parseRunId: pack.parseRunId,
        chunks,
      });
  if (!progress.success) {
    return progress;
  }
  const nextStep: JobStep = {
    jobId,
    step: 'index:text',
    revision: (step?.revision ?? 0) + 1,
    state: progress.data.kind === 'waiting' ? 'waiting' : 'completed',
    leaseUntil:
      progress.data.kind === 'waiting'
        ? (progress.data.resumeAfter ?? null)
        : null,
    checkpoint: progress.data.kind === 'waiting' ? progress.data : null,
    result: progress.data.kind === 'completed' ? progress.data : null,
  };
  const saved = await transaction.run<OperationResult<void>>(
    ownerId,
    async (unit) => {
      if (!(await unit.jobs.updateStep(nextStep, step?.revision ?? 0))) {
        return failure(
          'REVISION_CONFLICT',
          'Text index step changed concurrently',
        );
      }
      const job = await unit.jobs.get(jobId);
      if (!job) {
        return failure('NOT_FOUND', 'Source job not found');
      }
      const state =
        progress.data.kind === 'waiting'
          ? {
              kind: 'waiting' as const,
              stage: 'text_index',
              resumeAfter: progress.data.resumeAfter,
            }
          : { kind: 'running' as const, stage: 'image_index' };
      if (
        !(await unit.jobs.update(
          { ...job, state, updatedAt: clock.now() },
          job.updatedAt,
        ))
      ) {
        return failure(
          'REVISION_CONFLICT',
          'Source job changed during text index checkpoint',
        );
      }
      if (
        progress.data.kind === 'waiting' &&
        progress.data.providerJobId &&
        !handle
      ) {
        await unit.jobs.mapProviderJob(
          progress.data.provider,
          progress.data.providerJobId,
          jobId,
          'index:text',
        );
      }

      return { success: true, data: undefined };
    },
  );
  if (!saved.success) {
    return saved;
  }

  return progress.data.kind === 'waiting'
    ? { success: true, data: null }
    : { success: true, data: progress.data };
}

/**
 * Derives a stable citation UUID from a canonical page identifier.
 * @param pageId canonical page identifier
 * @returns deterministic page citation identifier
 */
function stableCitationId(pageId: string): string {
  const digest = createHash('sha256')
    .update(`source-citation:${pageId}`)
    .digest('hex');

  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}

/**
 * Checks whether a saved checkpoint can resume external text indexing.
 * @param value persisted checkpoint candidate
 * @returns whether the candidate has the required index handle fields
 */
function isTextIndexHandle(value: unknown): value is TextIndexHandle {
  return (
    value !== null &&
    typeof value === 'object' &&
    'sourceVersionId' in value &&
    typeof value.sourceVersionId === 'string' &&
    'parseRunId' in value &&
    typeof value.parseRunId === 'string' &&
    'provider' in value &&
    typeof value.provider === 'string' &&
    'providerDocumentIds' in value &&
    Array.isArray(value.providerDocumentIds) &&
    'checkpointAssetId' in value &&
    typeof value.checkpointAssetId === 'string' &&
    'index' in value &&
    value.index !== null &&
    typeof value.index === 'object'
  );
}

/**
 * Checks whether a completed index step has a usable mapping result.
 * @param value persisted result candidate
 * @returns whether count and mappings are present
 */
function isTextIndexResult(value: unknown): value is {
  readonly indexedCount: number;
  readonly mappings: readonly ProviderChunkMapping[];
} {
  return (
    value !== null &&
    typeof value === 'object' &&
    'indexedCount' in value &&
    typeof value.indexedCount === 'number' &&
    'mappings' in value &&
    Array.isArray(value.mappings)
  );
}

/**
 * Checks whether a saved checkpoint can resume provider parsing.
 * @param value persisted checkpoint candidate
 * @returns whether the parser handle fields are present
 */
function isParsingHandle(value: unknown): value is SourceParsingHandle {
  return (
    value !== null &&
    typeof value === 'object' &&
    'sourceVersionId' in value &&
    'parseRunId' in value &&
    'originalAssetId' in value &&
    'provider' in value &&
    'providerJobId' in value &&
    typeof value.sourceVersionId === 'string' &&
    typeof value.parseRunId === 'string' &&
    typeof value.originalAssetId === 'string' &&
    typeof value.provider === 'string' &&
    typeof value.providerJobId === 'string'
  );
}

/**
 * Checks whether a completed parse step contains a canonical source pack.
 * @param value persisted result candidate
 * @returns whether the expected pack collections are present
 */
function isParsedSourcePack(value: unknown): value is ParsedSourcePack {
  return (
    value !== null &&
    typeof value === 'object' &&
    'pages' in value &&
    Array.isArray(value.pages) &&
    'regions' in value &&
    Array.isArray(value.regions) &&
    'images' in value &&
    Array.isArray(value.images) &&
    'rawOutputAssetId' in value &&
    typeof value.rawOutputAssetId === 'string'
  );
}

/**
 * Restricts a parsed source pack to requested reprocessing pages.
 * @param pack complete parsed source pack
 * @param pageIds canonical page identifiers selected by the collector
 * @returns restricted pack, or null if a selected page was not parsed
 */
function selectParsedPages(
  pack: ParsedSourcePack,
  pageIds: readonly string[],
): ParsedSourcePack | null {
  const selected = new Set(pageIds);
  const pages = pack.pages.filter((page) => selected.has(page.id));
  if (pages.length !== selected.size) {
    return null;
  }

  return {
    ...pack,
    pages,
    regions: pack.regions.filter((region) => selected.has(region.pageId)),
    images: pack.images.filter(
      (image) =>
        image.locator.kind === 'page' && selected.has(image.locator.pageId),
    ),
    warnings: pack.warnings.filter(
      (warning) => warning.pageId === null || selected.has(warning.pageId),
    ),
  };
}

/**
 * Creates a public source operation failure with retryability from its code.
 * @param code public failure category
 * @param message safe user-facing explanation
 * @returns failed operation result
 */
function failure(
  code:
    | 'VALIDATION_FAILED'
    | 'FORBIDDEN'
    | 'UPLOAD_INCOMPLETE'
    | 'MEDIA_UNSUPPORTED'
    | 'SOURCE_UNAVAILABLE'
    | 'NOT_FOUND'
    | 'REVISION_CONFLICT',
  message: string,
): OperationResult<never> {
  return {
    success: false,
    error: { code, message, retryable: code === 'REVISION_CONFLICT' },
  };
}
