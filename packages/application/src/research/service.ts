import { requestFingerprint } from '../knowledge/receipt.js';

import type {
  CursorPage,
  Note,
  NoteInput,
  PublicError,
  ReferenceInput,
  ReferenceLink,
  ResearchAccepted,
  ResearchDetail,
  ResearchRequest,
  ModelSelection,
} from '@antica/contracts';
import type {
  CitedText,
  Source,
  SourceCitation,
  SourceVersion,
} from '@antica/domain';

import type {
  ClockPort,
  IdPort,
  IndexIdentity,
  ModelCatalogPort,
  OperationResult,
  PublicWebResearchPort,
  ResearchModelPort,
  RetrievalSnapshot,
  TextRetrievalPort,
  TransactionPort,
  UnitOfWork,
} from '../ports/index.js';

/** explicit research, saved notes, and record reference operations */
export interface ResearchService {
  submit(
    ownerId: string,
    input: ResearchRequest,
  ): Promise<OperationResult<ResearchAccepted>>;
  get(ownerId: string, id: string): Promise<OperationResult<ResearchDetail>>;
  saveNote(ownerId: string, input: NoteInput): Promise<OperationResult<Note>>;
  addReference(
    ownerId: string,
    input: ReferenceInput,
  ): Promise<OperationResult<ReferenceLink>>;
  listReferences(
    ownerId: string,
    recordId: string,
    filters: ReferenceFilters,
  ): Promise<OperationResult<CursorPage<ReferenceLink>>>;
}

/** authenticated record reference filters */
export interface ReferenceFilters {
  readonly checkId?: string;
  readonly observationId?: string;
  readonly cursor?: string;
  readonly limit?: number;
}

/**
 * creates explicit research and collector adoption operations
 * @param transaction collector-scoped unit of work
 * @param clock server clock
 * @param ids server identifier generator
 * @returns collector-scoped research and reference operations
 */
export function createResearchService(
  transaction: TransactionPort,
  clock: ClockPort,
  ids: IdPort,
): ResearchService {
  return {
    submit: async (ownerId, input) =>
      transaction.run<OperationResult<ResearchAccepted>>(
        ownerId,
        async (unit) => {
          const fingerprint = requestFingerprint(input);
          const prior = await unit.commands.get(
            ownerId,
            'research.submit',
            input.requestKey,
          );
          if (prior) {
            return prior.fingerprint === fingerprint
              ? { success: true, data: prior.result as ResearchAccepted }
              : failure(
                  'VALIDATION_FAILED',
                  'Idempotency key was used for a different research request',
                );
          }
          if (input.scope === 'curated_only' && input.sourceIds.length === 0) {
            return failure(
              'VALIDATION_FAILED',
              'Select at least one curated source',
            );
          }
          if (new Set(input.sourceIds).size !== input.sourceIds.length) {
            return failure(
              'VALIDATION_FAILED',
              'Research sources must be distinct',
            );
          }
          if (input.recordId && !(await unit.records.get(input.recordId))) {
            return failure('NOT_FOUND', 'Research record not found');
          }
          if (input.entryId && !(await unit.knowledge.get(input.entryId))) {
            return failure('NOT_FOUND', 'Research knowledge entry not found');
          }
          for (const sourceId of input.sourceIds) {
            if (!(await unit.sources.get(sourceId))) {
              return failure('SOURCE_UNAVAILABLE', 'Research source not found');
            }
          }
          const researchId = ids.create();
          const jobId = ids.create();
          const now = clock.now();
          await unit.jobs.create({
            id: jobId,
            kind: 'research',
            resourceId: researchId,
            state: { kind: 'queued' },
            createdAt: now,
            updatedAt: now,
            result: null,
          });
          await unit.research.create(researchId, jobId, input);
          await unit.outbox.enqueue({
            id: ids.create(),
            name: 'research',
            event: {
              eventId: ids.create(),
              schemaVersion: '1',
              jobId,
              resourceId: researchId,
              ownerId,
              idempotencyKey: input.requestKey,
            },
            createdAt: now,
            sentAt: null,
          });
          const accepted = { researchId, jobId };
          await unit.commands.insert({
            ownerId,
            operation: 'research.submit',
            requestKey: input.requestKey,
            fingerprint,
            status: 202,
            result: accepted,
          });

          return { success: true, data: accepted };
        },
      ),
    get: async (ownerId, id) =>
      transaction.run<OperationResult<ResearchDetail>>(
        ownerId,
        async (unit) => {
          const detail = await unit.research.get(id);

          return detail
            ? { success: true, data: detail }
            : failure('NOT_FOUND', 'Research not found');
        },
      ),
    saveNote: async (ownerId, input) =>
      transaction.run<OperationResult<Note>>(ownerId, async (unit) => {
        const fingerprint = requestFingerprint(input);
        const prior = await unit.commands.get(
          ownerId,
          'notes.create',
          input.requestKey,
        );
        if (prior) {
          return prior.fingerprint === fingerprint
            ? { success: true, data: prior.result as Note }
            : failure(
                'VALIDATION_FAILED',
                'Idempotency key was used for a different note',
              );
        }
        const detail = await unit.research.get(input.researchId);
        if (!detail) {
          return failure('NOT_FOUND', 'Research not found');
        }
        if (!detail.draft) {
          return failure(
            'SOURCE_UNAVAILABLE',
            'Research draft is not available',
          );
        }
        if (detail.draft.revision !== input.expectedDraftRevision) {
          return failure(
            'REVISION_CONFLICT',
            'Research draft changed since it was opened',
          );
        }
        if (input.recordId && !(await unit.records.get(input.recordId))) {
          return failure('NOT_FOUND', 'Note record not found');
        }
        if (input.entryId && !(await unit.knowledge.get(input.entryId))) {
          return failure('NOT_FOUND', 'Note knowledge entry not found');
        }
        const citations = new Map(
          detail.draft.citations.map((citation) => [citation.id, citation]),
        );
        for (const citation of input.citations) {
          if (
            !citations.has(citation.id) ||
            requestFingerprint(citations.get(citation.id)) !==
              requestFingerprint(citation)
          ) {
            return failure(
              'SOURCE_UNAVAILABLE',
              'Note citation does not belong to this research draft',
            );
          }
        }
        const cited = validateCitedText(input.paragraphs, input.citations);
        if (!cited.success) {
          return cited;
        }
        const note: Note = {
          id: ids.create(),
          researchId: input.researchId,
          titleZhHant: input.titleZhHant,
          paragraphs: input.paragraphs,
          citations: input.citations,
          recordId: input.recordId,
          entryId: input.entryId,
          savedBy: 'collector',
          savedAt: clock.now(),
        };
        await unit.research.addNote(note);
        await unit.commands.insert({
          ownerId,
          operation: 'notes.create',
          requestKey: input.requestKey,
          fingerprint,
          status: 201,
          result: note,
        });

        return { success: true, data: note };
      }),
    addReference: async (ownerId, input) =>
      transaction.run<OperationResult<ReferenceLink>>(ownerId, async (unit) => {
        const fingerprint = requestFingerprint(input);
        const prior = await unit.commands.get(
          ownerId,
          'references.create',
          input.requestKey,
        );
        if (prior) {
          return prior.fingerprint === fingerprint
            ? { success: true, data: prior.result as ReferenceLink }
            : failure(
                'VALIDATION_FAILED',
                'Idempotency key was used for a different reference',
              );
        }
        const record = await unit.records.get(input.target.recordId);
        if (!record) {
          return failure('NOT_FOUND', 'Reference target record not found');
        }
        const target = await validateReferenceTarget(unit, input);
        if (!target.success) {
          return target;
        }
        const subject = await validateReferenceSubject(unit, input);
        if (!subject.success) {
          return subject;
        }
        const identity = requestFingerprint({
          target: input.target,
          reference: input.reference,
        });
        const existing = await unit.research.findReference(
          input.target.recordId,
          identity,
        );
        if (existing) {
          await unit.commands.insert({
            ownerId,
            operation: 'references.create',
            requestKey: input.requestKey,
            fingerprint,
            status: 200,
            result: existing,
          });

          return { success: true, data: existing };
        }
        if (record.recordRevision !== input.expectedRecordRevision) {
          return failure(
            'REVISION_CONFLICT',
            'Record changed since it was opened',
          );
        }
        const versions = await unit.records.bumpVersions(
          record.id,
          record.recordRevision,
          { analysisInput: true, evidence: false },
        );
        if (!versions) {
          return failure(
            'REVISION_CONFLICT',
            'Record changed during reference save',
          );
        }
        const link: ReferenceLink = {
          id: ids.create(),
          target: input.target,
          reference: input.reference,
          comparisonId: input.comparisonId,
          noteZhHant: input.noteZhHant,
          createdAt: clock.now(),
          versions,
        };
        await unit.research.addReference(link, identity);
        await unit.commands.insert({
          ownerId,
          operation: 'references.create',
          requestKey: input.requestKey,
          fingerprint,
          status: 201,
          result: link,
        });

        return { success: true, data: link };
      }),
    listReferences: async (ownerId, recordId, filters) =>
      transaction.run<OperationResult<CursorPage<ReferenceLink>>>(
        ownerId,
        async (unit) => {
          if (!(await unit.records.get(recordId))) {
            return failure('NOT_FOUND', 'Record not found');
          }
          if (filters.checkId) {
            const check = await unit.evidence.getCheck(filters.checkId);
            if (!check || check.recordId !== recordId) {
              return failure(
                'EVIDENCE_INVALID',
                'Check filter does not belong to record',
              );
            }
          }
          if (filters.observationId) {
            const observation = await unit.evidence.getObservation(
              filters.observationId,
            );
            if (!observation || observation.recordId !== recordId) {
              return failure(
                'EVIDENCE_INVALID',
                'Observation filter does not belong to record',
              );
            }
          }

          return {
            success: true,
            data: await unit.research.queryReferences(recordId, {
              ...filters,
              limit: filters.limit ?? 50,
            }),
          };
        },
      ),
  };
}

/** research worker dependencies selected by the composition root */
export interface ResearchHandlerParams {
  readonly transaction: TransactionPort;
  readonly text: TextRetrievalPort;
  readonly web: PublicWebResearchPort;
  readonly model: ResearchModelPort;
  readonly catalog: ModelCatalogPort;
  readonly index: IndexIdentity;
  readonly selection: ModelSelection;
  readonly clock: ClockPort;
  readonly ids: IdPort;
}

const webUnavailableWarning = '公開網路搜尋未完成；已保留可用的收錄來源草稿。';

/**
 * drafts only from a saved frozen retrieval pack and validates every generated citation
 * @param params research dependencies and selected model profile
 * @returns durable research worker
 */
export function createResearchHandler(
  params: ResearchHandlerParams,
): (ownerId: string, jobId: string) => Promise<OperationResult<void>> {
  return async (ownerId, jobId) => {
    const prepared = await params.transaction.run<
      OperationResult<ResearchDetail>
    >(ownerId, async (unit) => {
      const job = await unit.jobs.get(jobId);
      if (!job || job.kind !== 'research') {
        return failure('NOT_FOUND', 'Research job not found');
      }
      const detail = await unit.research.get(job.resourceId);
      if (!detail) {
        return failure('NOT_FOUND', 'Research not found');
      }

      return { success: true, data: detail };
    });
    if (!prepared.success) {
      return prepared;
    }
    if (
      prepared.data.state.kind === 'succeeded' ||
      prepared.data.state.kind === 'partial'
    ) {
      return { success: true, data: undefined };
    }
    if (prepared.data.state.kind === 'failed') {
      const restarted = await params.transaction.run<OperationResult<void>>(
        ownerId,
        async (unit) => {
          const job = await unit.jobs.get(jobId);
          if (
            !job ||
            !(await unit.jobs.restartFailed(
              jobId,
              job.updatedAt,
              params.clock.now(),
            ))
          ) {
            return failure(
              'REVISION_CONFLICT',
              'Research job changed during retry',
            );
          }
          return { success: true, data: undefined };
        },
      );
      if (!restarted.success) {
        return restarted;
      }
    }
    const selected = await params.catalog.resolve(params.selection, {
      textInput: true,
      structuredOutput: true,
    });
    if (!selected.success) {
      return failResearch(params, ownerId, jobId, selected.error);
    }
    const persisted = await params.transaction.run(ownerId, async (unit) => ({
      success: true as const,
      data: await unit.research.getRetrievalSnapshot(prepared.data.researchId),
    }));
    const frozen: OperationResult<{
      readonly snapshot: RetrievalSnapshot;
      readonly webUnavailable: boolean;
    }> = persisted.data
      ? {
          success: true,
          data: {
            snapshot: persisted.data,
            webUnavailable: prepared.data.warningsZhHant.includes(
              webUnavailableWarning,
            ),
          },
        }
      : await freezeSources(params, prepared.data);
    if (!frozen.success) {
      return failResearch(params, ownerId, jobId, frozen.error);
    }
    const snapshot = frozen.data.snapshot;
    if (!persisted.data) {
      const saved = await params.transaction.run<OperationResult<void>>(
        ownerId,
        async (unit) => {
          const webSources = await persistWebSources(
            unit,
            snapshot,
            params.clock,
          );
          if (!webSources.success) {
            return webSources;
          }
          await unit.research.saveRetrievalSnapshot(snapshot);
          if (frozen.data.webUnavailable) {
            await unit.research.saveDetail({
              ...prepared.data,
              warningsZhHant: [
                ...prepared.data.warningsZhHant,
                webUnavailableWarning,
              ],
            });
          }
          const job = await unit.jobs.get(jobId);
          if (!job) {
            return failure('NOT_FOUND', 'Research job not found');
          }
          if (
            !(await unit.jobs.update(
              {
                ...job,
                state: { kind: 'running', stage: 'drafting' },
                updatedAt: params.clock.now(),
              },
              job.updatedAt,
            ))
          ) {
            return failure(
              'REVISION_CONFLICT',
              'Research job changed during retrieval',
            );
          }

          return { success: true, data: undefined };
        },
      );
      if (!saved.success) {
        return saved;
      }
    }
    const draft = await params.model.draft(
      prepared.data.request,
      { citations: snapshot.citations, text: snapshot.text },
      params.selection,
    );
    if (!draft.success) {
      return failResearch(params, ownerId, jobId, draft.error);
    }
    const verified = validateGeneratedDraft(
      draft.data.value.citations,
      draft.data.value.paragraphs,
      snapshot,
    );
    if (!verified.success) {
      return failResearch(params, ownerId, jobId, verified.error);
    }

    return params.transaction.run<OperationResult<void>>(
      ownerId,
      async (unit) => {
        const current = await unit.research.get(prepared.data.researchId);
        const job = await unit.jobs.get(jobId);
        if (!current || !job) {
          return failure('NOT_FOUND', 'Research job not found');
        }
        const now = params.clock.now();
        const state = frozen.data.webUnavailable
          ? {
              kind: 'partial' as const,
              completedAt: now,
              incompleteStages: ['public_web'],
            }
          : { kind: 'succeeded' as const, completedAt: now };
        const next = {
          ...current,
          state,
          sourceIds: [
            ...new Set(
              snapshot.citations.map((citation) => citation.locator.sourceId),
            ),
          ],
          draft: draft.data.value,
        };
        await unit.research.saveDetail(next);
        if (
          !(await unit.jobs.update(
            {
              ...job,
              state: next.state,
              updatedAt: now,
              result: draft.data.value,
            },
            job.updatedAt,
          ))
        ) {
          return failure(
            'REVISION_CONFLICT',
            'Research job changed during save',
          );
        }

        return { success: true, data: undefined };
      },
    );
  };
}

/**
 * freezes only selected curated citations and available public web excerpts
 * @param params retrieval and web search dependencies
 * @param detail saved research request and source scope
 * @returns immutable retrieval pack and web availability flag
 */
async function freezeSources(
  params: ResearchHandlerParams,
  detail: ResearchDetail,
): Promise<
  OperationResult<{
    readonly snapshot: RetrievalSnapshot;
    readonly webUnavailable: boolean;
  }>
> {
  const curated = detail.request.sourceIds.length
    ? await params.text.snapshot(detail.request.instructionZhHant, params.index)
    : {
        success: true as const,
        data: {
          id: detail.researchId,
          index: params.index,
          citations: [],
          text: [],
          methods: [],
          createdAt: params.clock.now(),
        },
      };
  if (!curated.success) {
    return curated;
  }
  const allowed = new Set(detail.request.sourceIds);
  const curatedCitations = curated.data.citations.filter((citation) =>
    allowed.has(citation.locator.sourceId),
  );
  const citationIds = new Set(curatedCitations.map((citation) => citation.id));
  const curatedText = curated.data.text.filter((item) =>
    citationIds.has(item.citationId),
  );
  const web =
    detail.request.scope === 'curated_and_public_web'
      ? await params.web.search(detail.request.instructionZhHant)
      : { success: true as const, data: [] };
  if (!web.success && curatedText.length === 0) {
    return web;
  }
  const webCitations = web.success ? web.data : [];
  const webText = webCitations.flatMap((citation) =>
    citation.locator.kind === 'web' &&
    citation.locator.excerptAsRetrieved?.trim()
      ? [
          {
            citationId: citation.id,
            contentAsRetrieved: citation.locator.excerptAsRetrieved,
            sourceRegionId: null,
          },
        ]
      : [],
  );

  return {
    success: true,
    data: {
      webUnavailable: !web.success,
      snapshot: {
        id: detail.researchId,
        index: params.index,
        citations: [...curatedCitations, ...webCitations],
        text: [...curatedText, ...webText],
        methods: [],
        createdAt: params.clock.now(),
      },
    },
  };
}

/**
 * saves a failed research state before returning the public error
 * @param params transaction, clock and identifier ports
 * @param ownerId authenticated collector identifier
 * @param jobId active research job identifier
 * @param error safe provider or validation error
 * @returns original failure when the state save succeeds
 */
async function failResearch(
  params: ResearchHandlerParams,
  ownerId: string,
  jobId: string,
  error: Omit<PublicError, 'requestId'>,
): Promise<OperationResult<void>> {
  const persisted = await params.transaction.run<OperationResult<void>>(
    ownerId,
    async (unit) => {
      const job = await unit.jobs.get(jobId);
      if (!job) {
        return failure('NOT_FOUND', 'Research job not found');
      }
      const detail = await unit.research.get(job.resourceId);
      if (!detail) {
        return failure('NOT_FOUND', 'Research not found');
      }
      const state = {
        kind: 'failed' as const,
        error: { ...error, requestId: params.ids.create() },
      };
      await unit.research.saveDetail({ ...detail, state });
      if (
        !(await unit.jobs.update(
          { ...job, state, updatedAt: params.clock.now() },
          job.updatedAt,
        ))
      ) {
        return failure(
          'REVISION_CONFLICT',
          'Research job changed during failure save',
        );
      }

      return { success: true, data: undefined };
    },
  );

  return persisted.success ? { success: false, error } : persisted;
}

/**
 * registers link-only web sources and citations in the frozen research pack
 * @param unit owner-scoped source repositories
 * @param snapshot immutable research retrieval pack
 * @param clock timestamp source for new web versions
 * @returns success when every web citation has canonical source identity
 */
async function persistWebSources(
  unit: UnitOfWork,
  snapshot: RetrievalSnapshot,
  clock: ClockPort,
): Promise<OperationResult<void>> {
  for (const citation of snapshot.citations) {
    if (citation.locator.kind !== 'web') {
      continue;
    }
    const locator = citation.locator;
    const existing = await unit.sources.get(
      locator.sourceId,
      locator.sourceVersionId,
    );
    if (!existing) {
      const metadata = {
        title: locator.url,
        contributors: [],
        authorStatus: 'unknown' as const,
        editionStatement: null,
        publisher: null,
        publicationDateAsPrinted: null,
        isbn: null,
        languages: [],
        canonicalUrl: locator.url,
        access: 'link_only' as const,
        rightsStatement: null,
        attributionText: null,
      };
      const now = clock.now();
      const source: Source = {
        id: locator.sourceId,
        revision: 1,
        createdAt: now,
        updatedAt: now,
        kind: 'web',
        metadata,
        currentVersionId: locator.sourceVersionId,
      };
      const version: SourceVersion = {
        id: locator.sourceVersionId,
        sourceId: locator.sourceId,
        originalAssetIds: [],
        sourceHash: requestFingerprint({
          sourceId: locator.sourceId,
          url: locator.url,
          retrievedAt: locator.retrievedAt,
        }),
        metadataSnapshot: metadata,
        capturedAt: now,
        retrievedAt: locator.retrievedAt,
        status: 'ready',
        textIndexStatus: 'ready',
        imageIndexStatus: 'partial',
        activeParseRunId: null,
      };
      const prior = await unit.sources.get(locator.sourceId);
      if (prior) {
        if (
          prior.source.kind !== 'web' ||
          prior.source.metadata.canonicalUrl !== locator.url
        ) {
          return failure(
            'SOURCE_UNAVAILABLE',
            'Web source identity does not match its saved URL',
          );
        }
        if (
          !(await unit.sources.addVersion(version, prior.source.revision, []))
        ) {
          return failure(
            'REVISION_CONFLICT',
            'Web source version changed during research save',
          );
        }
      } else {
        await unit.sources.create(source, version, []);
      }
    }
    await unit.sources.addCitation(citation);
  }

  return { success: true, data: undefined };
}

/**
 * verifies that every referenced target belongs to the selected record
 * @param unit owner-scoped evidence repositories
 * @param input requested record reference
 * @returns success only for matching target identifiers
 */
async function validateReferenceTarget(
  unit: UnitOfWork,
  input: ReferenceInput,
): Promise<OperationResult<void>> {
  const target = input.target;
  if (target.checkId) {
    const check = await unit.evidence.getCheck(target.checkId);
    if (!check || check.recordId !== target.recordId) {
      return failure(
        'EVIDENCE_INVALID',
        'Target check does not belong to record',
      );
    }
  }
  if (target.observationId) {
    const observation = await unit.evidence.getObservation(
      target.observationId,
    );
    if (!observation || observation.recordId !== target.recordId) {
      return failure(
        'EVIDENCE_INVALID',
        'Target observation does not belong to record',
      );
    }
  }
  if (target.evidenceAnchorId) {
    const anchor = await unit.evidence.getAnchor(target.evidenceAnchorId);
    if (!anchor || anchor.recordId !== target.recordId) {
      return failure(
        'EVIDENCE_INVALID',
        'Target evidence does not belong to record',
      );
    }
  }

  return { success: true, data: undefined };
}

/**
 * resolves collection or source locators against their saved identities
 * @param unit owner-scoped collection and source repositories
 * @param input requested reference identity and locator
 * @returns success only for an authentic saved subject
 */
async function validateReferenceSubject(
  unit: UnitOfWork,
  input: ReferenceInput,
): Promise<OperationResult<void>> {
  const subject = input.reference;
  if (subject.kind === 'collection') {
    if (!(await unit.records.get(subject.recordId))) {
      return failure('EVIDENCE_INVALID', 'Referenced record not found');
    }
    const media = await unit.media.get(subject.originalAssetId);
    if (
      !media ||
      media.owner.kind !== 'record' ||
      media.owner.recordId !== subject.recordId
    ) {
      return failure(
        'EVIDENCE_INVALID',
        'Referenced media does not belong to record',
      );
    }
    if (subject.evidenceAnchorId) {
      const anchor = await unit.evidence.getAnchor(subject.evidenceAnchorId);
      if (
        !anchor ||
        anchor.recordId !== subject.recordId ||
        anchor.originalAssetId !== subject.originalAssetId
      ) {
        return failure(
          'EVIDENCE_INVALID',
          'Referenced evidence does not match media',
        );
      }
    }

    return { success: true, data: undefined };
  }
  const locator = subject.locator;
  const source = await unit.sources.get(
    locator.sourceId,
    locator.sourceVersionId,
    locator.kind === 'page' ? locator.pageId : undefined,
  );
  if (!source || source.version.id !== locator.sourceVersionId) {
    return failure('SOURCE_UNAVAILABLE', 'Referenced source version not found');
  }
  if (locator.kind === 'page') {
    const page = await unit.sources.getPage(locator.pageId);
    if (
      !page ||
      page.sourceVersionId !== locator.sourceVersionId ||
      page.pageIndex !== locator.pageIndex ||
      page.printedPageLabel !== locator.printedPageLabel ||
      page.view.id !== locator.canonicalViewId
    ) {
      return failure('EVIDENCE_INVALID', 'Referenced page locator is invalid');
    }
    if (locator.regionId) {
      const region = source.regions.find(
        (candidate) =>
          candidate.id === locator.regionId && candidate.pageId === page.id,
      );
      if (
        !region ||
        (locator.region !== null &&
          requestFingerprint(region.region) !==
            requestFingerprint(locator.region))
      ) {
        return failure('EVIDENCE_INVALID', 'Referenced page region is invalid');
      }
    }
  } else if (
    source.source.kind !== 'web' ||
    source.version.retrievedAt !== locator.retrievedAt ||
    source.version.metadataSnapshot.canonicalUrl !== locator.url
  ) {
    return failure('EVIDENCE_INVALID', 'Referenced web locator is invalid');
  }
  if (subject.referenceImageId) {
    const image = source.referenceImages.find(
      (candidate) => candidate.id === subject.referenceImageId,
    );
    if (
      !image ||
      requestFingerprint(image.locator) !== requestFingerprint(locator)
    ) {
      return failure(
        'EVIDENCE_INVALID',
        'Reference image does not match source locator',
      );
    }
  }

  return { success: true, data: undefined };
}

/**
 * rejects generated citations absent from the frozen retrieval pack
 * @param citations generated citation copies
 * @param paragraphs generated cited statements
 * @param snapshot immutable source identities supplied to the model
 * @returns success only when identities and support markers resolve
 */
function validateGeneratedDraft(
  citations: readonly SourceCitation[],
  paragraphs: readonly CitedText[],
  snapshot: RetrievalSnapshot,
): OperationResult<void> {
  const frozen = new Map(
    snapshot.citations.map((citation) => [citation.id, citation]),
  );
  for (const citation of citations) {
    if (
      !frozen.has(citation.id) ||
      requestFingerprint(frozen.get(citation.id)) !==
        requestFingerprint(citation)
    ) {
      return failure(
        'SOURCE_UNAVAILABLE',
        'Generated citation was not in the frozen retrieval pack',
      );
    }
  }

  return validateCitedText(paragraphs, citations);
}

/**
 * ensures every claimed citation appears in the saved citation set
 * @param paragraphs proposed research or note statements
 * @param citations citations available to those statements
 * @returns success only for resolvable support markers
 */
function validateCitedText(
  paragraphs: readonly CitedText[],
  citations: readonly SourceCitation[],
): OperationResult<void> {
  const ids = new Set(citations.map((citation) => citation.id));
  for (const paragraph of paragraphs) {
    if (paragraph.support === 'cited' && paragraph.citationIds.length === 0) {
      return failure(
        'VALIDATION_FAILED',
        'Cited paragraph needs a source citation',
      );
    }
    if (paragraph.citationIds.some((id) => !ids.has(id))) {
      return failure(
        'SOURCE_UNAVAILABLE',
        'Paragraph citation does not resolve',
      );
    }
  }

  return { success: true, data: undefined };
}

/**
 * constructs a safe research operation error with code-specific retryability
 * @param code public failure category
 * @param message safe user-facing explanation
 * @returns failed operation result
 */
function failure(
  code:
    | 'VALIDATION_FAILED'
    | 'REVISION_CONFLICT'
    | 'NOT_FOUND'
    | 'SOURCE_UNAVAILABLE'
    | 'EVIDENCE_INVALID',
  message: string,
): OperationResult<never> {
  return {
    success: false,
    error: { code, message, retryable: code === 'REVISION_CONFLICT' },
  };
}
