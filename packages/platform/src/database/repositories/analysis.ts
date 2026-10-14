import { createHash } from 'node:crypto';

import { and, desc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';

import {
  actionResolutions,
  actionStates,
  adoptionEvents,
  analysisRuns,
  analysisSnapshots,
  claimCitations,
  claimEvidence,
  claimObservations,
  claims,
  nextActions,
  proposalFindings,
  proposals,
  proposalStates,
  recordChecks,
  records,
  resolutionChecks,
  resolutionEvidence,
  resolutionObservations,
  resolutionReferences,
  retrievalSnapshots,
  runSuggestedMethods,
  snapshotAssets,
  snapshotChecks,
  snapshotEvidence,
  snapshotObservations,
} from '../schema/index.js';

import { createEvidenceRepository } from './evidence.js';

import type {
  AnalysisRepository,
  AnalysisRunRecord,
  RequestedAnalysisSnapshot,
  RetrievalSnapshot,
} from '@antica/application/ports';
import type {
  ActionResolution,
  ActionState,
  AnalysisInput,
  AnalysisOutput,
  ProposalState,
  TaskPage,
  TaskQuery,
} from '@antica/contracts';

import type { Transaction } from '../transaction.js';

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function runScopedId(
  runId: string,
  kind: 'finding' | 'action' | 'proposal',
  generatedId: string,
): string {
  const bytes = createHash('sha256')
    .update(JSON.stringify([runId, kind, generatedId]))
    .digest();
  bytes[6] = (bytes[6]! & 0x0f) | 0x80;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function scopeOutputToRun(
  runId: string,
  output: AnalysisOutput,
): AnalysisOutput {
  const findings = new Map(
    output.findings.map((finding) => [
      finding.id,
      runScopedId(runId, 'finding', finding.id),
    ]),
  );
  if (
    findings.size !== output.findings.length ||
    new Set(output.nextActions.map((action) => action.id)).size !==
      output.nextActions.length ||
    new Set(output.proposedChanges.map((proposal) => proposal.id)).size !==
      output.proposedChanges.length
  ) {
    throw new Error('Analysis output contains duplicate generated IDs');
  }
  return {
    ...output,
    findings: output.findings.map((finding) => ({
      ...finding,
      id: findings.get(finding.id)!,
    })),
    nextActions: output.nextActions.map((action) => ({
      ...action,
      id: runScopedId(runId, 'action', action.id),
    })),
    proposedChanges: output.proposedChanges.map((proposal) => ({
      ...proposal,
      id: runScopedId(runId, 'proposal', proposal.id),
      findingIds: proposal.findingIds.map((findingId) => {
        const scopedId = findings.get(findingId);
        if (!scopedId) {
          throw new Error('Analysis proposal references an unknown finding');
        }
        return scopedId;
      }),
    })),
  };
}

function snapshotHash(value: unknown): string {
  const canonical = (item: unknown): unknown => {
    if (Array.isArray(item)) {
      return item.map(canonical);
    }
    if (item !== null && typeof item === 'object') {
      return Object.fromEntries(
        Object.entries(item)
          .filter(([, entry]) => entry !== undefined)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, entry]) => [key, canonical(entry)]),
      );
    }
    return item;
  };
  return hash(canonical(value));
}

type TaskCursor = {
  readonly signature: string;
  readonly updatedAt: string;
  readonly id: string;
  readonly kind: 'analysisAction' | 'recordCheck';
};

function decodeTaskCursor(value: string, signature: string): TaskCursor {
  const cursor = JSON.parse(
    Buffer.from(value, 'base64url').toString('utf8'),
  ) as TaskCursor;
  if (
    cursor.signature !== signature ||
    typeof cursor.updatedAt !== 'string' ||
    typeof cursor.id !== 'string' ||
    !['analysisAction', 'recordCheck'].includes(cursor.kind)
  ) {
    throw new Error('Task cursor does not match query');
  }

  return cursor;
}

function encodeTaskCursor(cursor: TaskCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

/**
 * persists immutable analysis snapshots/results and mutable resolution projections
 * @param tx transaction shared with the enclosing owner-scoped operation
 * @param ownerId collector whose runs and projections the repository may access
 * @returns repository for the collector's analysis runs and resolutions
 */
export function createAnalysisRepository(
  tx: Transaction,
  ownerId: string,
): AnalysisRepository {
  async function get(id: string): Promise<AnalysisRunRecord | null> {
    const [row] = await tx
      .select()
      .from(analysisRuns)
      .innerJoin(
        analysisSnapshots,
        eq(analysisRuns.snapshotId, analysisSnapshots.id),
      )
      .where(and(eq(analysisRuns.id, id), eq(analysisRuns.ownerId, ownerId)));
    if (!row) {
      return null;
    }
    const methods = await tx
      .select()
      .from(runSuggestedMethods)
      .where(eq(runSuggestedMethods.runId, id));
    const [retrieval] = row.analysis_runs.retrievalSnapshotId
      ? await tx
          .select()
          .from(retrievalSnapshots)
          .where(
            and(
              eq(retrievalSnapshots.id, row.analysis_runs.retrievalSnapshotId),
              eq(retrievalSnapshots.ownerId, ownerId),
            ),
          )
      : [];

    return {
      id: row.analysis_runs.id,
      jobId: row.analysis_runs.jobId,
      recordId: row.analysis_runs.recordId,
      requestedSnapshot: row.analysis_snapshots
        .content as RequestedAnalysisSnapshot,
      modelSelection: row.analysis_runs
        .modelSelection as AnalysisRunRecord['modelSelection'],
      input: row.analysis_runs.input as AnalysisInput | null,
      retrievalSnapshot:
        (retrieval?.immutablePack as RetrievalSnapshot | null) ?? null,
      output: row.analysis_runs.rawOutput as AnalysisOutput | null,
      invocation: row.analysis_runs.audit as AnalysisRunRecord['invocation'],
      failureAudits: row.analysis_runs.failureAudits,
      suggestedMethodVersions: methods.map((method) => ({
        methodId: method.methodId,
        methodVersionId: method.methodVersionId,
        owningEntryId: method.owningEntryId,
        titleZhHant: method.titleZhHant,
      })),
      status: row.analysis_runs.status as AnalysisRunRecord['status'],
    };
  }

  async function getResolution(id: string): Promise<ActionResolution | null> {
    const [row] = await tx
      .select()
      .from(actionResolutions)
      .where(eq(actionResolutions.id, id));
    if (!row) {
      return null;
    }
    const [run] = await tx
      .select({
        ownerId: analysisRuns.ownerId,
        recordId: analysisRuns.recordId,
      })
      .from(analysisRuns)
      .where(eq(analysisRuns.id, row.runId));
    if (run?.ownerId !== ownerId) {
      return null;
    }
    const [evidence, observations, references, checks] = await Promise.all([
      tx
        .select({ id: resolutionEvidence.anchorId })
        .from(resolutionEvidence)
        .where(eq(resolutionEvidence.resolutionId, id)),
      tx
        .select({ id: resolutionObservations.observationId })
        .from(resolutionObservations)
        .where(eq(resolutionObservations.resolutionId, id)),
      tx
        .select({ id: resolutionReferences.referenceId })
        .from(resolutionReferences)
        .where(eq(resolutionReferences.resolutionId, id)),
      tx
        .select({ id: resolutionChecks.checkId })
        .from(resolutionChecks)
        .where(eq(resolutionChecks.resolutionId, id)),
    ]);

    return {
      id: row.id,
      runId: row.runId,
      actionId: row.actionId,
      recordId: run.recordId,
      actionRevision: row.actionRevision,
      status: row.status as 'supplied' | 'dismissed',
      support: {
        evidenceAnchorIds: evidence.map((item) => item.id),
        observationIds: observations.map((item) => item.id),
        referenceLinkIds: references.map((item) => item.id),
        checkIds: checks.map((item) => item.id),
        onSiteDescription: row.onSiteDescription ?? undefined,
      },
      reason: row.reason,
      resolvedBy: 'collector',
      resolvedAt: new Date(row.createdAt).toISOString(),
      recordRevision: row.recordRevision,
    };
  }

  return {
    get,
    async getBySnapshotId(snapshotId) {
      const [row] = await tx
        .select({ id: analysisRuns.id })
        .from(analysisRuns)
        .where(
          and(
            eq(analysisRuns.ownerId, ownerId),
            eq(analysisRuns.snapshotId, snapshotId),
          ),
        )
        .orderBy(desc(analysisRuns.createdAt))
        .limit(1);

      return row ? get(row.id) : null;
    },
    async create(run) {
      const snapshot = run.requestedSnapshot;
      if (
        snapshot.recordId !== run.recordId ||
        run.input !== null ||
        run.retrievalSnapshot !== null ||
        run.output !== null ||
        run.invocation !== null ||
        run.failureAudits.length !== 0
      ) {
        throw new Error(
          'Analysis run must begin from an unbound frozen snapshot',
        );
      }
      const contentHash = snapshotHash(snapshot);
      const [created] = await tx
        .insert(analysisSnapshots)
        .values({
          id: snapshot.id,
          ownerId,
          recordId: snapshot.recordId,
          recordRevision: snapshot.recordRevision,
          analysisInputVersion: snapshot.analysisInputVersion,
          evidenceVersion: snapshot.evidenceVersion,
          content: snapshot,
          contentHash,
          createdAt: snapshot.createdAt,
        })
        .onConflictDoNothing()
        .returning({ id: analysisSnapshots.id });
      if (created) {
        if (snapshot.assetIds.length) {
          await tx.insert(snapshotAssets).values(
            snapshot.assetIds.map((assetId) => ({
              snapshotId: snapshot.id,
              assetId,
            })),
          );
        }
        if (snapshot.evidenceIds.length) {
          await tx.insert(snapshotEvidence).values(
            snapshot.evidenceIds.map((anchorId) => ({
              snapshotId: snapshot.id,
              anchorId,
            })),
          );
        }
        if (snapshot.observationIds.length) {
          await tx.insert(snapshotObservations).values(
            snapshot.observationIds.map((observationId) => ({
              snapshotId: snapshot.id,
              observationId,
            })),
          );
        }
        if (snapshot.checkIds.length) {
          await tx.insert(snapshotChecks).values(
            snapshot.checkIds.map((checkId) => ({
              snapshotId: snapshot.id,
              checkId,
            })),
          );
        }
      } else {
        const [existing] = await tx
          .select({
            ownerId: analysisSnapshots.ownerId,
            recordId: analysisSnapshots.recordId,
            content: analysisSnapshots.content,
          })
          .from(analysisSnapshots)
          .where(eq(analysisSnapshots.id, snapshot.id));
        if (
          !existing ||
          existing.ownerId !== ownerId ||
          existing.recordId !== snapshot.recordId ||
          snapshotHash(existing.content) !== contentHash
        ) {
          throw new Error(
            'Analysis snapshot ID conflicts with different frozen content',
          );
        }
      }
      await tx.insert(analysisRuns).values({
        id: run.id,
        ownerId,
        recordId: run.recordId,
        jobId: run.jobId,
        snapshotId: snapshot.id,
        status: run.status,
        requestedModelId: run.modelSelection.modelId,
        modelSelection: run.modelSelection,
        profileVersion: run.modelSelection.profileVersion,
        promptVersion: 'pending',
        schemaVersion: 'pending',
      });
      if (run.suggestedMethodVersions.length) {
        await tx.insert(runSuggestedMethods).values(
          run.suggestedMethodVersions.map((method) => ({
            runId: run.id,
            ...method,
          })),
        );
      }
    },
    async setStatus(id, expectedStatuses, status) {
      const mutableStatuses = expectedStatuses.filter(
        (value) => value === 'queued' || value === 'running',
      );
      if (!mutableStatuses.length) {
        return false;
      }
      const [changed] = await tx
        .update(analysisRuns)
        .set({
          status,
          completedAt:
            status === 'failed' ||
            status === 'completed' ||
            status === 'partial'
              ? sql`now()`
              : undefined,
        })
        .where(
          and(
            eq(analysisRuns.id, id),
            eq(analysisRuns.ownerId, ownerId),
            inArray(analysisRuns.status, mutableStatuses),
          ),
        )
        .returning({ id: analysisRuns.id });

      return Boolean(changed);
    },
    async bindRetrievalSnapshot(runId, input, snapshot) {
      if (input.retrievalSnapshotId !== snapshot.id) {
        throw new Error('Retrieval snapshot ID mismatch');
      }
      const [run] = await tx
        .select({ id: analysisRuns.id, input: analysisRuns.input })
        .from(analysisRuns)
        .where(
          and(eq(analysisRuns.id, runId), eq(analysisRuns.ownerId, ownerId)),
        );
      if (!run || run.input !== null) {
        return false;
      }
      await tx.insert(retrievalSnapshots).values({
        id: snapshot.id,
        ownerId,
        indexVersionId: null,
        immutablePack: snapshot,
        contentHash: hash(snapshot),
        createdAt: snapshot.createdAt,
      });
      const [bound] = await tx
        .update(analysisRuns)
        .set({
          input,
          retrievalSnapshotId: snapshot.id,
          promptVersion: input.promptVersion,
          schemaVersion: input.schemaVersion,
        })
        .where(
          and(
            eq(analysisRuns.id, runId),
            eq(analysisRuns.ownerId, ownerId),
            isNull(analysisRuns.input),
          ),
        )
        .returning({ id: analysisRuns.id });
      if (!bound) {
        await tx
          .delete(retrievalSnapshots)
          .where(eq(retrievalSnapshots.id, snapshot.id));
      }

      return Boolean(bound);
    },
    /**
     * appends failed generated content without changing validated output
     * @param id analysis run identifier
     * @param audit provider failure content and invocation metadata
     * @returns whether the caller owns a mutable run
     */
    async appendFailureAudit(id, audit): Promise<boolean> {
      const [changed] = await tx
        .update(analysisRuns)
        .set({
          failureAudits: sql`${analysisRuns.failureAudits} || ${JSON.stringify([audit])}::jsonb`,
          audit: audit.invocation,
          effectiveModelId: audit.invocation?.effectiveModelId ?? null,
          providerVersion: audit.invocation?.providerModelVersion ?? null,
        })
        .where(
          and(
            eq(analysisRuns.id, id),
            eq(analysisRuns.ownerId, ownerId),
            inArray(analysisRuns.status, ['queued', 'running']),
          ),
        )
        .returning({ id: analysisRuns.id });

      return Boolean(changed);
    },
    async saveOutput(
      id,
      generatedOutput,
      suggestedMethodVersions,
      invocation,
      status,
    ) {
      const output = scopeOutputToRun(id, generatedOutput);
      const [run] = await tx
        .update(analysisRuns)
        .set({
          rawOutput: output,
          audit: invocation,
          effectiveModelId: invocation.effectiveModelId,
          providerVersion: invocation.providerModelVersion,
          status,
          completedAt: sql`now()`,
        })
        .where(
          and(
            eq(analysisRuns.id, id),
            eq(analysisRuns.ownerId, ownerId),
            isNull(analysisRuns.rawOutput),
          ),
        )
        .returning({
          recordId: analysisRuns.recordId,
          createdAt: analysisRuns.createdAt,
        });
      if (!run) {
        throw new Error('Analysis output is already saved or inaccessible');
      }
      if (suggestedMethodVersions.length) {
        await tx
          .insert(runSuggestedMethods)
          .values(
            suggestedMethodVersions.map((method) => ({ runId: id, ...method })),
          );
      }
      if (output.findings.length) {
        await tx.insert(claims).values(
          output.findings.map((finding) => ({
            id: finding.id,
            runId: id,
            kind: finding.kind,
            text: finding.text,
            relation: finding.relation,
            certainty: finding.certainty,
          })),
        );
      }
      for (const finding of output.findings) {
        if (finding.evidenceIds.length) {
          await tx.insert(claimEvidence).values(
            finding.evidenceIds.map((anchorId) => ({
              claimId: finding.id,
              anchorId,
            })),
          );
        }
        if (finding.observationIds.length) {
          await tx.insert(claimObservations).values(
            finding.observationIds.map((observationId) => ({
              claimId: finding.id,
              observationId,
            })),
          );
        }
        if (finding.citationIds.length) {
          await tx.insert(claimCitations).values(
            finding.citationIds.map((citationId) => ({
              claimId: finding.id,
              citationId,
            })),
          );
        }
      }
      if (output.nextActions.length) {
        await tx.insert(nextActions).values(
          output.nextActions.map((action) => ({
            id: action.id,
            runId: id,
            recordId: run.recordId,
            kind: action.kind,
            instruction: action.instruction,
            reason: action.reason,
            checkId: action.checkId,
          })),
        );
        await tx.insert(actionStates).values(
          output.nextActions.map((action) => ({
            runId: id,
            actionId: action.id,
            recordId: run.recordId,
            status: 'pending',
          })),
        );
      }
      if (output.proposedChanges.length) {
        await tx.insert(proposals).values(
          output.proposedChanges.map((proposal) => ({
            id: proposal.id,
            runId: id,
            field: proposal.field,
            before: sql`${JSON.stringify(proposal.before)}::jsonb`,
            proposed: sql`${JSON.stringify(proposal.proposed)}::jsonb`,
          })),
        );
        await tx.insert(proposalStates).values(
          output.proposedChanges.map((proposal) => ({
            runId: id,
            proposalId: proposal.id,
            status: 'pending',
          })),
        );
        for (const proposal of output.proposedChanges) {
          if (proposal.findingIds.length) {
            await tx.insert(proposalFindings).values(
              proposal.findingIds.map((claimId) => ({
                proposalId: proposal.id,
                claimId,
              })),
            );
          }
        }
      }
      // Request order, including the UUID tie-breaker, survives out-of-order completion.
      await tx
        .update(records)
        .set({ latestRunId: id })
        .where(
          and(
            eq(records.id, run.recordId),
            eq(records.ownerId, ownerId),
            or(
              isNull(records.latestRunId),
              sql`exists (
                select 1 from ${analysisRuns} previous
                where previous.id = ${records.latestRunId}
                  and previous.owner_id = ${ownerId}
                  and previous.record_id = ${run.recordId}
                  and (previous.created_at, previous.id) <= (${run.createdAt}::timestamptz, ${id}::uuid)
              )`,
            ),
          ),
        );
    },
    async getActionState(runId, actionId): Promise<ActionState | null> {
      const [row] = await tx
        .select()
        .from(actionStates)
        .innerJoin(
          analysisRuns,
          and(
            eq(actionStates.runId, analysisRuns.id),
            eq(analysisRuns.ownerId, ownerId),
          ),
        )
        .where(
          and(
            eq(actionStates.runId, runId),
            eq(actionStates.actionId, actionId),
          ),
        );

      return row
        ? {
            runId,
            actionId,
            recordId: row.action_states.recordId,
            revision: row.action_states.revision,
            status: row.action_states.status as ActionState['status'],
            latestResolutionId: row.action_states.latestResolutionId,
            updatedAt: new Date(row.action_states.updatedAt).toISOString(),
          }
        : null;
    },
    async updateActionState(state, expectedRevision, resolution) {
      const [changed] = await tx
        .update(actionStates)
        .set({
          revision: resolution.actionRevision,
          status: resolution.status,
          latestResolutionId: resolution.id,
          updatedAt: resolution.resolvedAt,
        })
        .where(
          and(
            eq(actionStates.runId, state.runId),
            eq(actionStates.actionId, state.actionId),
            eq(actionStates.recordId, state.recordId),
            eq(actionStates.revision, expectedRevision),
            sql`exists (select 1 from analysis_runs where analysis_runs.id = ${state.runId} and analysis_runs.owner_id = ${ownerId})`,
          ),
        )
        .returning({ runId: actionStates.runId });
      if (!changed) {
        return false;
      }
      await tx.insert(actionResolutions).values({
        id: resolution.id,
        runId: resolution.runId,
        actionId: resolution.actionId,
        actionRevision: resolution.actionRevision,
        recordRevision: resolution.recordRevision,
        status: resolution.status,
        reason: resolution.reason,
        onSiteDescription: resolution.support.onSiteDescription,
        createdAt: resolution.resolvedAt,
      });
      if (resolution.support.evidenceAnchorIds?.length) {
        await tx.insert(resolutionEvidence).values(
          resolution.support.evidenceAnchorIds.map((anchorId) => ({
            resolutionId: resolution.id,
            anchorId,
          })),
        );
      }
      if (resolution.support.observationIds?.length) {
        await tx.insert(resolutionObservations).values(
          resolution.support.observationIds.map((observationId) => ({
            resolutionId: resolution.id,
            observationId,
          })),
        );
      }
      if (resolution.support.referenceLinkIds?.length) {
        await tx.insert(resolutionReferences).values(
          resolution.support.referenceLinkIds.map((referenceId) => ({
            resolutionId: resolution.id,
            referenceId,
          })),
        );
      }
      if (resolution.support.checkIds?.length) {
        await tx.insert(resolutionChecks).values(
          resolution.support.checkIds.map((checkId) => ({
            resolutionId: resolution.id,
            checkId,
          })),
        );
      }

      return true;
    },
    async getProposalStates(runId): Promise<readonly ProposalState[]> {
      const rows = await tx
        .select()
        .from(proposalStates)
        .innerJoin(
          analysisRuns,
          and(
            eq(proposalStates.runId, analysisRuns.id),
            eq(analysisRuns.ownerId, ownerId),
          ),
        )
        .where(eq(proposalStates.runId, runId));

      return rows.map((row) => ({
        proposalId: row.proposal_states.proposalId,
        status: row.proposal_states.status as ProposalState['status'],
        latestAdoptionEventId: row.proposal_states.latestEventId,
      }));
    },
    async appendAdoption(runId, proposalId, status, eventId) {
      const [run] = await tx
        .select({ recordId: analysisRuns.recordId })
        .from(analysisRuns)
        .where(
          and(eq(analysisRuns.id, runId), eq(analysisRuns.ownerId, ownerId)),
        );
      if (!run) {
        throw new Error('Analysis run not found');
      }
      const [record] = await tx
        .select({ revision: records.recordRevision })
        .from(records)
        .where(and(eq(records.id, run.recordId), eq(records.ownerId, ownerId)));
      if (!record) {
        throw new Error('Record not found');
      }
      await tx.insert(adoptionEvents).values({
        id: eventId,
        runId,
        proposalId,
        status,
        recordRevision: record.revision,
      });
      const [changed] = await tx
        .update(proposalStates)
        .set({ status, latestEventId: eventId })
        .where(
          and(
            eq(proposalStates.runId, runId),
            eq(proposalStates.proposalId, proposalId),
            eq(proposalStates.status, 'pending'),
          ),
        )
        .returning({ proposalId: proposalStates.proposalId });
      if (!changed) {
        throw new Error('Proposal already resolved');
      }
    },
    async queryTasks(query: TaskQuery): Promise<TaskPage> {
      const limit = Math.min(query.limit ?? 30, 100);
      const signature = hash({
        recordId: query.recordId ?? null,
        actionStatus: query.actionStatus ?? null,
      });
      const cursor = query.cursor
        ? decodeTaskCursor(query.cursor, signature)
        : null;
      const actionAfter = cursor
        ? or(
            lt(actionStates.updatedAt, cursor.updatedAt),
            and(
              eq(actionStates.updatedAt, cursor.updatedAt),
              lt(actionStates.actionId, cursor.id),
            ),
            cursor.kind === 'recordCheck'
              ? and(
                  eq(actionStates.updatedAt, cursor.updatedAt),
                  eq(actionStates.actionId, cursor.id),
                )
              : undefined,
          )
        : undefined;
      const checkAfter = cursor
        ? or(
            lt(recordChecks.updatedAt, cursor.updatedAt),
            and(
              eq(recordChecks.updatedAt, cursor.updatedAt),
              lt(recordChecks.id, cursor.id),
            ),
          )
        : undefined;
      const actionRows = await tx
        .select()
        .from(actionStates)
        .innerJoin(
          nextActions,
          and(
            eq(actionStates.runId, nextActions.runId),
            eq(actionStates.actionId, nextActions.id),
          ),
        )
        .innerJoin(
          analysisRuns,
          and(
            eq(actionStates.runId, analysisRuns.id),
            eq(analysisRuns.ownerId, ownerId),
          ),
        )
        .where(
          and(
            query.recordId
              ? eq(actionStates.recordId, query.recordId)
              : undefined,
            query.actionStatus
              ? eq(actionStates.status, query.actionStatus)
              : eq(actionStates.status, 'pending'),
            actionAfter,
          ),
        )
        .orderBy(desc(actionStates.updatedAt), desc(actionStates.actionId))
        .limit(limit + 1);
      const checkRows = await tx
        .select()
        .from(recordChecks)
        .where(
          and(
            eq(recordChecks.ownerId, ownerId),
            query.recordId
              ? eq(recordChecks.recordId, query.recordId)
              : undefined,
            sql`${recordChecks.progress} <> 'recorded'`,
            checkAfter,
          ),
        )
        .orderBy(desc(recordChecks.updatedAt), desc(recordChecks.id))
        .limit(limit + 1);
      const rawTimes = new Map<string, string>([
        ...actionRows.map(
          (row) =>
            [
              `analysisAction:${row.action_states.actionId}`,
              row.action_states.updatedAt,
            ] as const,
        ),
        ...checkRows.map(
          (row) => [`recordCheck:${row.id}`, row.updatedAt] as const,
        ),
      ]);
      const evidence = createEvidenceRepository(tx, ownerId);
      const tasks = await Promise.all([
        ...actionRows.map(async (row) => ({
          kind: 'analysisAction' as const,
          recordId: row.action_states.recordId,
          runId: row.action_states.runId,
          action: {
            id: row.next_actions.id,
            kind: row.next_actions.kind as
              | 'capturePhoto'
              | 'selectVideoFrame'
              | 'describe'
              | 'confirmFeature'
              | 'inspectSource',
            instruction: row.next_actions.instruction,
            reason: row.next_actions.reason,
            checkId: row.next_actions.checkId ?? undefined,
          },
          state: {
            runId: row.action_states.runId,
            actionId: row.action_states.actionId,
            recordId: row.action_states.recordId,
            revision: row.action_states.revision,
            status: row.action_states.status as ActionState['status'],
            latestResolutionId: row.action_states.latestResolutionId,
            updatedAt: new Date(row.action_states.updatedAt).toISOString(),
          },
          latestResolution: row.action_states.latestResolutionId
            ? getResolution(row.action_states.latestResolutionId)
            : Promise.resolve(null),
        })),
        ...checkRows.map(async (row) => {
          const check = (await evidence.getCheck(row.id))!;

          return {
            kind: 'recordCheck' as const,
            recordId: row.recordId,
            check: {
              ...check,
              componentIds: [...check.componentIds],
              observationIds: [...check.observationIds],
              evidenceAnchorIds: [...check.evidenceAnchorIds],
              pendingActionIds: [...check.pendingActionIds],
            },
          };
        }),
      ]);
      const resolved = await Promise.all(
        tasks.map(async (task) =>
          task.kind === 'analysisAction'
            ? { ...task, latestResolution: await task.latestResolution }
            : task,
        ),
      );
      const sorted = [...resolved].sort((a, b) => {
        const aId = a.kind === 'analysisAction' ? a.state.actionId : a.check.id;
        const bId = b.kind === 'analysisAction' ? b.state.actionId : b.check.id;
        const aTime = rawTimes.get(`${a.kind}:${aId}`)!;
        const bTime = rawTimes.get(`${b.kind}:${bId}`)!;

        return (
          bTime.localeCompare(aTime) ||
          bId.localeCompare(aId) ||
          b.kind.localeCompare(a.kind)
        );
      });
      const page = sorted.slice(0, limit);
      const last = page.at(-1);
      const lastId =
        last?.kind === 'analysisAction' ? last.state.actionId : last?.check.id;

      return {
        items: page,
        nextCursor:
          sorted.length > limit && last && lastId
            ? encodeTaskCursor({
                signature,
                kind: last.kind,
                updatedAt: rawTimes.get(`${last.kind}:${lastId}`)!,
                id: lastId,
              })
            : null,
      };
    },
  };
}
