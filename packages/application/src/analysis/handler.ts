import { isDeepStrictEqual } from 'node:util';

import {
  analysisOutputSchema,
  validateAnalysisReferences,
} from '@antica/contracts';
import { validateEvidenceAnchor } from '@antica/domain';

import type { AnalysisInput } from '@antica/contracts';
import type { Region } from '@antica/domain';

import type {
  AnalysisModelPort,
  ClockPort,
  IndexIdentity,
  ModelFailureAudit,
  ModelCatalogPort,
  OperationResult,
  RequestedAnalysisSnapshot,
  TextRetrievalPort,
  TransactionPort,
} from '../ports/index.js';

/** fetches immutable media bytes only when a frozen analysis job executes */
export interface AnalysisMediaReader {
  read(
    key: string,
  ): Promise<{ readonly bytes: Uint8Array; readonly mimeType: string }>;
  renderRegion(image: {
    readonly originalAssetId: string;
    readonly canonicalViewId: string;
    readonly bytes: Uint8Array;
    readonly region: Region;
  }): Promise<OperationResult<Uint8Array>>;
}

/** Resolve immutable frozen evidence to owner-scoped persisted image locators. */
async function selectEvidenceImages(
  transaction: TransactionPort,
  ownerId: string,
  frozen: RequestedAnalysisSnapshot,
): Promise<OperationResult<SelectedEvidenceImage[]>> {
  return transaction.run<OperationResult<SelectedEvidenceImage[]>>(
    ownerId,
    async (unit) => {
      const selected: SelectedEvidenceImage[] = [];
      for (const anchor of frozen.frozenPack.evidence) {
        if (
          !frozen.evidenceIds.includes(anchor.id) ||
          anchor.recordId !== frozen.recordId ||
          !validateEvidenceAnchor(anchor)
        ) {
          return invalidEvidence('Frozen evidence anchor is invalid');
        }
        const media = frozen.frozenPack.media.find(
          (asset) => asset.id === anchor.originalAssetId,
        );
        if (
          !media ||
          !frozen.assetIds.includes(media.id) ||
          media.state !== 'ready' ||
          media.purpose !== 'object' ||
          media.owner.kind !== 'record' ||
          media.owner.recordId !== frozen.recordId
        ) {
          return invalidEvidence(
            'Evidence original is outside the frozen record',
          );
        }
        const view = media.views.find(
          (candidate) => candidate.id === anchor.canonicalViewId,
        );
        if (!view || view.originalAssetId !== anchor.originalAssetId) {
          return invalidEvidence(
            'Evidence view is outside the frozen original',
          );
        }
        const [currentView, source] = await Promise.all([
          unit.media.getCanonicalView(view.id),
          unit.media.getCanonicalViewSource(view.id),
        ]);
        if (
          !currentView ||
          !isDeepStrictEqual(currentView, view) ||
          !source ||
          source.originalAssetId !== anchor.originalAssetId ||
          source.derivativeId !== view.derivativeId
        ) {
          return invalidEvidence('Evidence view locator is stale');
        }
        if (
          (anchor.kind === 'image' &&
            (media.kind !== 'photo' ||
              view.originalCoordinateSpace !== 'image_pixels')) ||
          (anchor.kind === 'video_frame' &&
            (media.kind !== 'video' ||
              view.originalCoordinateSpace !== 'video_frame_pixels' ||
              view.derivativeId !== anchor.frame.frameDerivativeId))
        ) {
          return invalidEvidence('Evidence kind does not match its view');
        }
        if (view.derivativeId) {
          const derivative = await unit.media.getDerivative(view.derivativeId);
          if (
            !derivative ||
            derivative.originalAssetId !== anchor.originalAssetId ||
            derivative.storageKey !== source.storageKey ||
            derivative.mimeType !== source.mimeType ||
            (anchor.kind === 'image' && derivative.kind !== 'canonical') ||
            (anchor.kind === 'video_frame' &&
              (derivative.kind !== 'frame' ||
                !isDeepStrictEqual(derivative.frame, anchor.frame)))
          ) {
            return invalidEvidence(
              'Evidence derivative does not match its frozen locator',
            );
          }
        }
        let storageKey = source.storageKey;
        let mimeType = source.mimeType;
        let region: Region | null = null;
        if (anchor.scope.kind === 'region') {
          const cropId = anchor.scope.cropDerivativeId;
          if (cropId) {
            const crop = await unit.media.getDerivative(cropId);
            if (
              !crop ||
              crop.kind !== 'crop' ||
              crop.originalAssetId !== anchor.originalAssetId ||
              crop.parentDerivativeId !== view.derivativeId ||
              !isDeepStrictEqual(crop.region, anchor.scope.region)
            ) {
              return invalidEvidence(
                'Evidence crop does not match its frozen region',
              );
            }
            storageKey = crop.storageKey;
            mimeType = crop.mimeType;
          } else {
            region = anchor.scope.region;
          }
        }
        if (!/^image\/(?:png|jpeg|webp)$/u.test(mimeType)) {
          return invalidEvidence(
            'Evidence locator does not contain a supported image',
          );
        }
        selected.push({
          evidenceId: anchor.id,
          originalAssetId: anchor.originalAssetId,
          canonicalViewId: anchor.canonicalViewId,
          storageKey,
          mimeType,
          region,
        });
      }

      return { success: true, data: selected };
    },
  );
}

/** @param message */
function invalidEvidence(message: string): OperationResult<never> {
  return {
    success: false,
    error: { code: 'EVIDENCE_INVALID', message, retryable: false },
  };
}

interface SelectedEvidenceImage {
  readonly evidenceId: string;
  readonly originalAssetId: string;
  readonly canonicalViewId: string;
  readonly storageKey: string;
  readonly mimeType: string;
  readonly region: Region | null;
}

/** dependencies for one durable analysis job execution */
export interface AnalysisHandlerParams {
  readonly transaction: TransactionPort;
  readonly text: TextRetrievalPort;
  readonly index: IndexIdentity;
  readonly model: AnalysisModelPort;
  readonly catalog: ModelCatalogPort;
  readonly media: AnalysisMediaReader;
  readonly clock: ClockPort;
}

/**
 * executes a previously authorized and frozen run
 * @param params
 */
export function createAnalysisHandler(
  params: AnalysisHandlerParams,
): (ownerId: string, jobId: string) => Promise<OperationResult<void>> {
  return async (ownerId, jobId) => {
    const result = await executeAnalysis(params, ownerId, jobId);
    if (!result.success && !result.error.retryable) {
      const settled = await markAnalysisFailed(
        params.transaction,
        ownerId,
        jobId,
      );
      if (!settled.success) {
        return settled;
      }
    }

    return result;
  };
}

/** Execute one frozen analysis; retryable failures retain its running status. */
async function executeAnalysis(
  params: AnalysisHandlerParams,
  ownerId: string,
  jobId: string,
): Promise<OperationResult<void>> {
  const initial = await params.transaction.run(ownerId, async (unit) => {
    const job = await unit.jobs.get(jobId);
    if (!job || job.kind !== 'analysis') {
      return {
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Analysis job not found',
          retryable: false,
        },
      };
    }
    const run = await unit.analyses.get(job.resourceId);

    if (run?.status === 'failed') {
      return {
        success: false,
        error: {
          code: 'JOB_FAILED',
          message: 'Analysis run has already failed',
          retryable: false,
        },
      };
    }
    if (
      run?.status === 'queued' &&
      !(await unit.analyses.setStatus(run.id, ['queued'], 'running'))
    ) {
      return {
        success: false,
        error: {
          code: 'REVISION_CONFLICT',
          message: 'Analysis run changed before execution',
          retryable: true,
        },
      };
    }

    return run
      ? { success: true, data: { job, run } }
      : {
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'Analysis run not found',
            retryable: false,
          },
        };
  });
  if (!initial.success) {
    return initial;
  }
  if (initial.data.run.output) {
    return { success: true, data: undefined };
  }
  const selection = initial.data.run.modelSelection;
  const capability = await params.catalog.resolve(selection, {
    textInput: true,
    imageInput: true,
    structuredOutput: true,
  });
  if (!capability.success) {
    return capability;
  }
  const frozen = initial.data.run.requestedSnapshot;
  const query = [
    frozen.frozenPack.recordFields.name ?? '',
    frozen.frozenPack.recordFields.description,
    frozen.frozenPack.recordFields.period?.label ?? '',
    ...frozen.frozenPack.recordFields.tags,
  ]
    .join(' ')
    .trim();
  const fetched = initial.data.run.retrievalSnapshot
    ? { success: true as const, data: initial.data.run.retrievalSnapshot }
    : await params.text.snapshot(query, params.index);
  if (!fetched.success) {
    return fetched;
  }
  const snapshot = fetched.data;
  const input: AnalysisInput = initial.data.run.input ?? {
    recordId: frozen.recordId,
    snapshotId: frozen.id,
    recordRevision: frozen.recordRevision,
    analysisInputVersion: frozen.analysisInputVersion,
    evidenceVersion: frozen.evidenceVersion,
    assetIds: [...frozen.assetIds],
    evidenceIds: [...frozen.evidenceIds],
    observationIds: [...frozen.observationIds],
    checkIds: [...frozen.checkIds],
    retrievalSnapshotId: snapshot.id,
    promptVersion: 'analysis-prompt-v1',
    schemaVersion: 'analysis-output-v1',
  };
  if (!initial.data.run.input) {
    const bound = await params.transaction.run<OperationResult<boolean>>(
      ownerId,
      async (unit) => ({
        success: true,
        data: await unit.analyses.bindRetrievalSnapshot(
          initial.data.run.id,
          input,
          snapshot,
        ),
      }),
    );
    if (!bound.success) {
      return bound;
    }
    if (!bound.data) {
      return {
        success: false,
        error: {
          code: 'REVISION_CONFLICT',
          message: 'Analysis snapshot was bound concurrently',
          retryable: true,
        },
      };
    }
  }
  const selected = await selectEvidenceImages(
    params.transaction,
    ownerId,
    frozen,
  );
  if (!selected.success) {
    return selected;
  }
  const images: Array<{
    readonly evidenceId: string;
    readonly mediaType: string;
    readonly bytes: Uint8Array;
  }> = [];
  for (const image of selected.data) {
    const object = await params.media.read(image.storageKey);
    if (object.mimeType !== image.mimeType) {
      return invalidEvidence('Evidence media type changed after selection');
    }
    if (image.region) {
      const rendered = await params.media.renderRegion({
        originalAssetId: image.originalAssetId,
        canonicalViewId: image.canonicalViewId,
        bytes: object.bytes,
        region: image.region,
      });
      if (!rendered.success) {
        return rendered;
      }
      images.push({
        evidenceId: image.evidenceId,
        mediaType: 'image/png',
        bytes: rendered.data,
      });
    } else {
      images.push({
        evidenceId: image.evidenceId,
        mediaType: image.mimeType,
        bytes: object.bytes,
      });
    }
  }
  const pack = {
    input,
    recordFields: frozen.frozenPack.recordFields,
    text: [
      ...frozen.frozenPack.observations.map((observation) => ({
        id: observation.id,
        kind: 'observation' as const,
        content: observation.text,
      })),
      ...frozen.frozenPack.checks.map((check) => ({
        id: check.id,
        kind: 'check' as const,
        content: JSON.stringify(check.result),
      })),
      ...snapshot.text.map((item) => ({
        kind: 'source' as const,
        citationId: item.citationId,
        contentAsRetrieved: item.contentAsRetrieved,
        sourceRegionId: item.sourceRegionId,
      })),
    ],
    images,
    citations: snapshot.citations,
    methods: snapshot.methods,
  };
  const modeled = await params.model.analyze(pack, selection);
  if (!modeled.success) {
    const recorded = await appendFailureAudit(
      params.transaction,
      ownerId,
      initial.data.run.id,
      modeled.audit,
    );

    return recorded.success ? modeled : recorded;
  }
  const output = analysisOutputSchema.safeParse(modeled.data.value);
  if (!output.success) {
    const recorded = await appendFailureAudit(
      params.transaction,
      ownerId,
      initial.data.run.id,
      {
        invocation: modeled.data.invocation,
        rawOutput: modeled.data.value,
      },
    );
    if (!recorded.success) {
      return recorded;
    }

    return {
      success: false,
      error: {
        code: 'VALIDATION_FAILED',
        message: 'Analysis output failed validation',
        retryable: false,
      },
    };
  }
  const rejected = validateAnalysisReferences(output.data, {
    evidenceIds: new Set(frozen.evidenceIds),
    observationIds: new Set(frozen.observationIds),
    citationIds: new Set(snapshot.citations.map((citation) => citation.id)),
    checkIds: new Set(frozen.checkIds),
    methodIds: new Set(snapshot.methods.map((method) => method.methodId)),
  });
  if (rejected.length > 0) {
    const recorded = await appendFailureAudit(
      params.transaction,
      ownerId,
      initial.data.run.id,
      {
        invocation: {
          ...modeled.data.invocation,
          citationCheck: {
            valid: false,
            rejectedReferenceIds: [...rejected],
          },
        },
        rawOutput: modeled.data.value,
      },
    );
    if (!recorded.success) {
      return recorded;
    }

    return {
      success: false,
      error: {
        code: 'EVIDENCE_INVALID',
        message: 'Analysis output referenced evidence outside its snapshot',
        retryable: false,
      },
    };
  }

  return params.transaction.run(ownerId, async (unit) => {
    const job = await unit.jobs.get(jobId);
    const run = await unit.analyses.get(initial.data.run.id);
    if (!job || !run) {
      return {
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Analysis job or run not found',
          retryable: false,
        },
      };
    }
    if (run.output) {
      return { success: true, data: undefined };
    }
    const suggestedMethods = snapshot.methods
      .filter((method) =>
        output.data.suggestedMethodIds.includes(method.methodId),
      )
      .map(({ methodId, methodVersionId, owningEntryId, titleZhHant }) => ({
        methodId,
        methodVersionId,
        owningEntryId,
        titleZhHant,
      }));
    await unit.analyses.saveOutput(
      run.id,
      output.data,
      suggestedMethods,
      modeled.data.invocation,
      'completed',
    );
    const now = params.clock.now();
    if (
      !(await unit.jobs.update(
        {
          ...job,
          state: { kind: 'succeeded', completedAt: now },
          updatedAt: now,
          result: { runId: run.id },
        },
        job.updatedAt,
      ))
    ) {
      return {
        success: false,
        error: {
          code: 'REVISION_CONFLICT',
          message: 'Analysis job changed during completion',
          retryable: true,
        },
      };
    }

    return { success: true, data: undefined };
  });
}

/** Persist generated-only failure data before returning a model or output error. */
async function appendFailureAudit(
  transaction: TransactionPort,
  ownerId: string,
  runId: string,
  audit: ModelFailureAudit,
): Promise<OperationResult<void>> {
  const recorded = await transaction.run(ownerId, async (unit) => ({
    success: true as const,
    data: await unit.analyses.appendFailureAudit(runId, {
      invocation: audit.invocation,
      rawOutput: audit.rawOutput ?? null,
    }),
  }));

  return recorded.data
    ? { success: true, data: undefined }
    : {
        success: false,
        error: {
          code: 'REVISION_CONFLICT',
          message: 'Analysis run changed before failure audit save',
          retryable: true,
        },
      };
}

/** Persist a terminal run status before the outbox marks its job failed. */
async function markAnalysisFailed(
  transaction: TransactionPort,
  ownerId: string,
  jobId: string,
): Promise<OperationResult<void>> {
  return transaction.run<OperationResult<void>>(ownerId, async (unit) => {
    const job = await unit.jobs.get(jobId);
    if (!job || job.kind !== 'analysis') {
      return { success: true, data: undefined };
    }
    const run = await unit.analyses.get(job.resourceId);
    if (
      !run ||
      run.status === 'failed' ||
      run.status === 'completed' ||
      run.status === 'partial'
    ) {
      return { success: true, data: undefined };
    }
    if (!(await unit.analyses.setStatus(run.id, [run.status], 'failed'))) {
      return {
        success: false,
        error: {
          code: 'REVISION_CONFLICT',
          message: 'Analysis run changed during failure save',
          retryable: true,
        },
      };
    }

    return { success: true, data: undefined };
  });
}
