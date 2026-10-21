import { createHash } from 'node:crypto';

import { isProposalCurrent, sourceCitationSchema } from '@antica/contracts';

import { adoptedFields, recordFieldsOf } from '../record/fields.js';

import type {
  ActionResolutionRequest,
  ActionResolutionResult,
  AnalysisAccepted,
  AnalysisRunDetail,
  ApplyAnalysisChanges,
  MediaAsset,
  ModelSelection,
  RecordDetail,
  RecordPatch,
  RequestAnalysis,
  TaskPage,
  TaskQuery,
} from '@antica/contracts';
import type { Observation } from '@antica/domain';

import type {
  AnalysisRunRecord,
  ClockPort,
  IdPort,
  ModelCatalogPort,
  OperationResult,
  TransactionPort,
} from '../ports/index.js';

/** explicit analysis, review, and adoption commands */
export interface AnalysisService {
  request(
    ownerId: string,
    recordId: string,
    requestKey: string,
    input: RequestAnalysis,
  ): Promise<OperationResult<AnalysisAccepted>>;
  get(
    ownerId: string,
    runId: string,
  ): Promise<OperationResult<AnalysisRunDetail>>;
  /**
   * adopts and skips proposals field by field and records one history entry per decision
   *
   * `input.expectedRecordRevision` is the record revision the collector saw when
   * tapping apply, not the revision frozen when the analysis ran: it rejects a
   * stale screen once (retryable). Each proposal's `before` is the
   * stale-proposal guard, so only a selected field that changed since the
   * analysis blocks adoption (A7); unselected and skipped fields may change.
   * @param ownerId authenticated collector
   * @param runId completed analysis run
   * @param requestKey idempotency key of the adoption
   * @param input selected and skipped proposals with the displayed record revision
   * @returns updated record, or a typed failure
   */
  apply(
    ownerId: string,
    runId: string,
    requestKey: string,
    input: ApplyAnalysisChanges,
  ): Promise<OperationResult<RecordDetail>>;
  resolveAction(
    ownerId: string,
    runId: string,
    actionId: string,
    requestKey: string,
    input: ActionResolutionRequest,
  ): Promise<OperationResult<ActionResolutionResult>>;
  tasks(ownerId: string, query: TaskQuery): Promise<OperationResult<TaskPage>>;
}

/**
 * creates the collector-controlled analysis use cases
 * @param transaction
 * @param catalog
 * @param selection
 * @param clock
 * @param ids
 */
export function createAnalysisService(
  transaction: TransactionPort,
  catalog: ModelCatalogPort,
  selection: ModelSelection,
  clock: ClockPort,
  ids: IdPort,
): AnalysisService {
  return {
    request: async (ownerId, recordId, requestKey, input) => {
      const selected = {
        ...selection,
        modelId: input.modelId ?? selection.modelId,
      };
      const capability = await catalog.resolve(selected, {
        textInput: true,
        imageInput: true,
        structuredOutput: true,
      });
      if (!capability.success) {
        return capability;
      }

      return transaction.run(ownerId, async (unit) => {
        const fingerprint = digest({ recordId, input });
        const prior = await unit.commands.get(
          ownerId,
          'analysis.request',
          requestKey,
        );
        if (prior) {
          return prior.fingerprint === fingerprint
            ? { success: true, data: prior.result as AnalysisAccepted }
            : {
                success: false,
                error: {
                  code: 'VALIDATION_FAILED',
                  message: 'Idempotency key was used for a different request',
                  retryable: false,
                },
              };
        }
        const record = await unit.records.get(recordId);
        if (!record) {
          return {
            success: false,
            error: {
              code: 'NOT_FOUND',
              message: 'Record not found',
              retryable: false,
            },
          };
        }
        if (record.recordRevision !== input.expectedRecordRevision) {
          return {
            success: false,
            error: {
              code: 'REVISION_CONFLICT',
              message: 'Record changed before analysis request',
              retryable: true,
            },
          };
        }
        const reused = input.inputSnapshotId
          ? await unit.analyses.getBySnapshotId(input.inputSnapshotId)
          : null;
        if (
          input.inputSnapshotId &&
          (!reused || reused.recordId !== recordId)
        ) {
          return {
            success: false,
            error: {
              code: 'NOT_FOUND',
              message: 'Requested analysis snapshot not found',
              retryable: false,
            },
          };
        }
        const media =
          reused?.requestedSnapshot.frozenPack.media ??
          (
            await Promise.all(
              record.mediaIds.map(async (id) => unit.media.get(id)),
            )
          ).filter(
            (asset): asset is MediaAsset =>
              asset?.state === 'ready' && asset.purpose === 'object',
          );
        const evidence =
          reused?.requestedSnapshot.frozenPack.evidence ??
          (
            await Promise.all(
              media.map(async (asset) =>
                unit.evidence.queryAnchorsByAsset(asset.id),
              ),
            )
          ).flat();
        const observations =
          reused?.requestedSnapshot.frozenPack.observations ??
          (await collectObservations(
            (...args) => unit.evidence.queryObservations(...args),
            recordId,
          ));
        const checks =
          reused?.requestedSnapshot.frozenPack.checks ??
          (
            await Promise.all(
              record.checkIds.map(async (id) => unit.evidence.getCheck(id)),
            )
          ).filter((check) => check !== null);
        const now = clock.now();
        const snapshotId = reused?.requestedSnapshot.id ?? ids.create();
        const requestedSnapshot = reused?.requestedSnapshot ?? {
          id: snapshotId,
          recordId,
          recordRevision: record.recordRevision,
          analysisInputVersion: record.analysisInputVersion,
          evidenceVersion: record.evidenceVersion,
          assetIds: media.map((asset) => asset.id),
          evidenceIds: evidence.map((anchor) => anchor.id),
          observationIds: observations.map((observation) => observation.id),
          checkIds: checks.map((check) => check.id),
          frozenPack: {
            recordFields: recordFieldsOf(record),
            media,
            evidence,
            observations,
            checks,
          },
          createdAt: now,
        };
        const runId = ids.create();
        const jobId = ids.create();
        const run: AnalysisRunRecord = {
          id: runId,
          jobId,
          recordId,
          requestedSnapshot,
          input: null,
          retrievalSnapshot: null,
          output: null,
          invocation: null,
          failureAudits: [],
          suggestedMethodVersions: [],
          modelSelection: selected,
          status: 'queued',
        };
        await unit.jobs.create({
          id: jobId,
          kind: 'analysis',
          resourceId: runId,
          state: { kind: 'queued' },
          createdAt: now,
          updatedAt: now,
          result: null,
        });
        await unit.analyses.create(run);
        await unit.outbox.enqueue({
          id: ids.create(),
          name: 'antica.analysis.requested',
          event: {
            eventId: ids.create(),
            schemaVersion: '1',
            jobId,
            resourceId: runId,
            ownerId,
            idempotencyKey: requestKey,
          },
          createdAt: now,
          sentAt: null,
        });
        const accepted: AnalysisAccepted = {
          runId,
          jobId,
          status: 'queued',
          inputSnapshotId: snapshotId,
          analysisInputVersion: requestedSnapshot.analysisInputVersion,
        };
        await unit.commands.insert({
          ownerId,
          operation: 'analysis.request',
          requestKey,
          fingerprint,
          status: 202,
          result: accepted,
        });

        return { success: true, data: accepted };
      });
    },
    get: async (ownerId, runId) =>
      transaction.run(ownerId, async (unit) => {
        const run = await unit.analyses.get(runId);
        if (!run) {
          return {
            success: false,
            error: {
              code: 'NOT_FOUND',
              message: 'Analysis not found',
              retryable: false,
            },
          };
        }
        const actionStates = (
          await Promise.all(
            (run.output?.nextActions ?? []).map(async (action) =>
              unit.analyses.getActionState(runId, action.id),
            ),
          )
        ).filter((state) => state !== null);
        const proposalStates = await unit.analyses.getProposalStates(runId);
        const snapshot = run.requestedSnapshot;

        return {
          success: true,
          data: {
            runId,
            recordId: run.recordId,
            jobId: run.jobId,
            status: run.status,
            snapshot: {
              id: snapshot.id,
              recordRevision: snapshot.recordRevision,
              analysisInputVersion: snapshot.analysisInputVersion,
              evidenceVersion: snapshot.evidenceVersion,
              assetIds: [...snapshot.assetIds],
              evidenceIds: [...snapshot.evidenceIds],
              observationIds: [...snapshot.observationIds],
              checkIds: [...snapshot.checkIds],
              retrievalSnapshotId: run.input?.retrievalSnapshotId ?? null,
            },
            citations: (run.retrievalSnapshot?.citations ?? []).map(
              (citation) => sourceCitationSchema.parse(citation),
            ),
            suggestedMethods: [...run.suggestedMethodVersions],
            invocation: run.invocation,
            failureAudits: [...run.failureAudits],
            result: {
              output: run.output,
              actionStates,
              proposalStates: [...proposalStates],
            },
          },
        };
      }),
    apply: async (ownerId, runId, requestKey, input) =>
      transaction.run(ownerId, async (unit) => {
        const fingerprint = digest({ runId, input });
        const prior = await unit.commands.get(
          ownerId,
          'analysis.apply',
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
        const run = await unit.analyses.get(runId);
        if (!run?.output) {
          return {
            success: false,
            error: {
              code: 'NOT_FOUND',
              message: 'Completed analysis not found',
              retryable: false,
            },
          };
        }
        const record = await unit.records.get(run.recordId);
        if (!record) {
          return {
            success: false,
            error: {
              code: 'NOT_FOUND',
              message: 'Record not found',
              retryable: false,
            },
          };
        }
        if (record.recordRevision !== input.expectedRecordRevision) {
          return {
            success: false,
            error: {
              code: 'REVISION_CONFLICT',
              message: 'Record changed before adoption',
              retryable: true,
            },
          };
        }
        const decided = [
          ...input.selectedProposalIds,
          ...(input.skippedProposalIds ?? []),
        ];
        if (new Set(decided).size !== decided.length) {
          return {
            success: false,
            error: {
              code: 'VALIDATION_FAILED',
              message: 'Select or skip each proposal once',
              retryable: false,
            },
          };
        }
        const states = await unit.analyses.getProposalStates(runId);
        const selected = run.output.proposedChanges.filter((change) =>
          input.selectedProposalIds.includes(change.id),
        );
        if (
          selected.length !== input.selectedProposalIds.length ||
          decided.some(
            (id) =>
              !states.some(
                (state) =>
                  state.proposalId === id && state.status === 'pending',
              ),
          )
        ) {
          return {
            success: false,
            error: {
              code: 'VALIDATION_FAILED',
              message: 'Selected proposal is unavailable',
              retryable: false,
            },
          };
        }
        if (
          new Set(selected.map((proposal) => proposal.field)).size !==
          selected.length
        ) {
          return {
            success: false,
            error: {
              code: 'VALIDATION_FAILED',
              message: 'Select only one change per field',
              retryable: false,
            },
          };
        }
        let fields: RecordPatch['fields'] = {};
        for (const proposal of selected) {
          if (!isProposalCurrent(record, proposal)) {
            return {
              success: false,
              error: {
                code: 'REVISION_CONFLICT',
                message: 'A proposed field changed since analysis',
                retryable: true,
              },
            };
          }
          fields = { ...fields, ...adoptedFields(proposal) };
        }
        const versions = {
          recordRevision: record.recordRevision + 1,
          analysisInputVersion: record.analysisInputVersion,
          evidenceVersion: record.evidenceVersion,
        };
        const updated = await unit.records.patch(
          record.id,
          { expectedRevision: record.recordRevision, fields },
          versions,
        );
        if (!updated) {
          return {
            success: false,
            error: {
              code: 'REVISION_CONFLICT',
              message: 'Record changed during adoption',
              retryable: true,
            },
          };
        }
        for (const proposal of selected) {
          await unit.analyses.appendAdoption(
            runId,
            proposal.id,
            'accepted',
            ids.create(),
          );
        }
        for (const id of input.skippedProposalIds ?? []) {
          await unit.analyses.appendAdoption(
            runId,
            id,
            'skipped',
            ids.create(),
          );
        }
        await unit.commands.insert({
          ownerId,
          operation: 'analysis.apply',
          requestKey,
          fingerprint,
          status: 200,
          result: updated,
        });

        return { success: true, data: updated };
      }),
    resolveAction: async (ownerId, runId, actionId, requestKey, input) =>
      transaction.run(ownerId, async (unit) => {
        const fingerprint = digest({ runId, actionId, input });
        const prior = await unit.commands.get(
          ownerId,
          'analysis.resolveAction',
          requestKey,
        );
        if (prior) {
          return prior.fingerprint === fingerprint
            ? { success: true, data: prior.result as ActionResolutionResult }
            : {
                success: false,
                error: {
                  code: 'VALIDATION_FAILED',
                  message: 'Idempotency key was used for a different request',
                  retryable: false,
                },
              };
        }
        const run = await unit.analyses.get(runId);
        const action = run?.output?.nextActions.find(
          (item) => item.id === actionId,
        );
        const state = await unit.analyses.getActionState(runId, actionId);
        if (!run || !action || !state) {
          return {
            success: false,
            error: {
              code: 'NOT_FOUND',
              message: 'Analysis action not found',
              retryable: false,
            },
          };
        }
        const record = await unit.records.get(run.recordId);
        if (!record) {
          return {
            success: false,
            error: {
              code: 'NOT_FOUND',
              message: 'Record not found',
              retryable: false,
            },
          };
        }
        if (
          record.recordRevision !== input.expectedRecordRevision ||
          state.revision !== input.expectedActionRevision
        ) {
          return {
            success: false,
            error: {
              code: 'REVISION_CONFLICT',
              message: 'Record or action changed',
              retryable: true,
            },
          };
        }
        const support = input.support ?? {};
        for (const id of support.evidenceAnchorIds ?? []) {
          const anchor = await unit.evidence.getAnchor(id);
          if (!anchor || anchor.recordId !== record.id) {
            return {
              success: false,
              error: {
                code: 'EVIDENCE_INVALID',
                message: 'Action evidence does not belong to this record',
                retryable: false,
              },
            };
          }
        }
        for (const id of support.observationIds ?? []) {
          const observation = await unit.evidence.getObservation(id);
          if (!observation || observation.recordId !== record.id) {
            return {
              success: false,
              error: {
                code: 'EVIDENCE_INVALID',
                message: 'Action observation does not belong to this record',
                retryable: false,
              },
            };
          }
        }
        for (const id of support.checkIds ?? []) {
          const check = await unit.evidence.getCheck(id);
          if (!check || check.recordId !== record.id) {
            return {
              success: false,
              error: {
                code: 'EVIDENCE_INVALID',
                message: 'Action check does not belong to this record',
                retryable: false,
              },
            };
          }
        }
        for (const id of support.referenceLinkIds ?? []) {
          const reference = await unit.research.getReference(id);
          if (!reference || reference.target.recordId !== record.id) {
            return {
              success: false,
              error: {
                code: 'EVIDENCE_INVALID',
                message: 'Action reference does not belong to this record',
                retryable: false,
              },
            };
          }
        }
        const versions = await unit.records.bumpVersions(
          record.id,
          record.recordRevision,
          { analysisInput: false, evidence: false },
        );
        if (!versions) {
          return {
            success: false,
            error: {
              code: 'REVISION_CONFLICT',
              message: 'Record changed during action resolution',
              retryable: true,
            },
          };
        }
        const resolution = {
          id: ids.create(),
          runId,
          actionId,
          recordId: record.id,
          actionRevision: state.revision + 1,
          status: input.status,
          support,
          reason: input.status === 'dismissed' ? input.reason : null,
          resolvedBy: 'collector' as const,
          resolvedAt: clock.now(),
          recordRevision: versions.recordRevision,
        };
        if (
          !(await unit.analyses.updateActionState(
            state,
            input.expectedActionRevision,
            resolution,
          ))
        ) {
          return {
            success: false,
            error: {
              code: 'REVISION_CONFLICT',
              message: 'Action changed during resolution',
              retryable: true,
            },
          };
        }
        const result: ActionResolutionResult = {
          state: {
            ...state,
            revision: state.revision + 1,
            status: input.status,
            latestResolutionId: resolution.id,
            updatedAt: resolution.resolvedAt,
          },
          resolution,
          versions,
        };
        await unit.commands.insert({
          ownerId,
          operation: 'analysis.resolveAction',
          requestKey,
          fingerprint,
          status: 200,
          result,
        });

        return { success: true, data: result };
      }),
    tasks: async (ownerId, query) =>
      transaction.run(ownerId, async (unit) => ({
        success: true,
        data: await unit.analyses.queryTasks(query),
      })),
  };
}

/**
 * @param query
 * @param recordId
 */
async function collectObservations(
  query: (
    recordId: string,
    cursor?: string,
    limit?: number,
  ) => Promise<{
    readonly items: readonly Observation[];
    readonly nextCursor: string | null;
  }>,
  recordId: string,
): Promise<Observation[]> {
  const observations: Observation[] = [];
  let cursor: string | undefined;
  do {
    const page = await query(recordId, cursor, 100);
    observations.push(...page.items);
    cursor = page.nextCursor ?? undefined;
  } while (cursor);

  return observations;
}

/** @param value */
function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
