import { createHash } from 'node:crypto';

import { z } from 'zod';

import {
  analysisInputSchema,
  analysisOutputSchema,
  modelSelectionSchema,
  modelInvocationSchema,
  modelFailureAuditSchema,
  recordFieldsSchema,
  mediaAssetSchema,
  evidenceAnchorSchema,
  observationSchema,
  recordCheckSchema,
  sourceCitationSchema,
  retrievedMethodSchema,
} from '@antica/contracts';

import { Prisma } from '../generated/client.js';
import { jsonValue } from '../json.js';

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
  AnalysisOutput,
  ProposalState,
  TaskPage,
  TaskQuery,
} from '@antica/contracts';

import type { actionStates, nextActions } from '../generated/client.js';

import type { Transaction } from '../transaction.js';

const requestedSnapshotSchema: z.ZodType<RequestedAnalysisSnapshot> = z.object({
  id: z.string(),
  recordId: z.string(),
  recordRevision: z.number(),
  analysisInputVersion: z.number(),
  evidenceVersion: z.number(),
  assetIds: z.array(z.string()),
  evidenceIds: z.array(z.string()),
  observationIds: z.array(z.string()),
  checkIds: z.array(z.string()),
  frozenPack: z.object({
    recordFields: recordFieldsSchema,
    media: z.array(mediaAssetSchema),
    evidence: z.array(evidenceAnchorSchema),
    observations: z.array(observationSchema),
    checks: z.array(recordCheckSchema),
  }),
  createdAt: z.string(),
});
const retrievalSnapshotSchema: z.ZodType<RetrievalSnapshot> = z.object({
  id: z.string(),
  index: z.object({
    embeddingModelId: z.string(),
    dimensions: z.number(),
    indexVersion: z.string(),
  }),
  citations: z.array(sourceCitationSchema),
  text: z.array(
    z.object({
      citationId: z.string(),
      contentAsRetrieved: z.string(),
      sourceRegionId: z.string().nullable(),
    }),
  ),
  methods: z.array(retrievedMethodSchema),
  createdAt: z.string(),
});

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
    const run = await tx.analysisRuns.findFirst({
      where: { id, ownerId },
      include: { analysisSnapshots: true },
    });
    if (!run) {
      return null;
    }
    const methods = await tx.runSuggestedMethods.findMany({
      where: { runId: id },
    });
    const retrieval = run.retrievalSnapshotId
      ? await tx.retrievalSnapshots.findFirst({
          where: { id: run.retrievalSnapshotId, ownerId },
        })
      : null;

    return {
      id: run.id,
      jobId: run.jobId,
      recordId: run.recordId,
      requestedSnapshot: requestedSnapshotSchema.parse(
        run.analysisSnapshots.content,
      ),
      modelSelection: modelSelectionSchema.parse(run.modelSelection),
      input: analysisInputSchema.nullable().parse(run.input),
      retrievalSnapshot: retrievalSnapshotSchema
        .nullable()
        .parse(retrieval?.immutablePack ?? null),
      output: analysisOutputSchema.nullable().parse(run.rawOutput),
      invocation: modelInvocationSchema.nullable().parse(run.audit),
      failureAudits: z.array(modelFailureAuditSchema).parse(run.failureAudits),
      suggestedMethodVersions: methods.map((method) => ({
        methodId: method.methodId,
        methodVersionId: method.methodVersionId,
        owningEntryId: method.owningEntryId,
        titleZhHant: method.titleZhHant,
      })),
      status: run.status as AnalysisRunRecord['status'],
    };
  }

  async function getResolution(id: string): Promise<ActionResolution | null> {
    const row = await tx.actionResolutions.findFirst({ where: { id } });
    if (!row) {
      return null;
    }
    const run = await tx.analysisRuns.findFirst({
      select: { ownerId: true, recordId: true },
      where: { id: row.runId },
    });
    if (run?.ownerId !== ownerId) {
      return null;
    }
    const [evidence, observations, references, checks] = await Promise.all([
      tx.resolutionEvidence
        .findMany({ select: { anchorId: true }, where: { resolutionId: id } })
        .then((rows) => rows.map((row) => ({ id: row.anchorId }))),
      tx.resolutionObservations
        .findMany({
          select: { observationId: true },
          where: { resolutionId: id },
        })
        .then((rows) => rows.map((row) => ({ id: row.observationId }))),
      tx.resolutionReferences
        .findMany({
          select: { referenceId: true },
          where: { resolutionId: id },
        })
        .then((rows) => rows.map((row) => ({ id: row.referenceId }))),
      tx.resolutionChecks
        .findMany({ select: { checkId: true }, where: { resolutionId: id } })
        .then((rows) => rows.map((row) => ({ id: row.checkId }))),
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
      const row = await tx.analysisRuns.findFirst({
        select: { id: true },
        where: { ownerId, snapshotId },
        orderBy: { createdAt: 'desc' },
      });

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
      const [created] = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        insert into analysis_snapshots (id, owner_id, record_id, record_revision, analysis_input_version,
          evidence_version, content, content_hash, created_at)
        values (${snapshot.id}::uuid, ${ownerId}, ${snapshot.recordId}::uuid, ${snapshot.recordRevision},
          ${snapshot.analysisInputVersion}, ${snapshot.evidenceVersion}, ${JSON.stringify(snapshot)}::jsonb,
          ${contentHash}, ${snapshot.createdAt}::timestamptz)
        on conflict do nothing returning id
      `);
      if (created) {
        if (snapshot.assetIds.length) {
          await tx.snapshotAssets.createMany({
            data: snapshot.assetIds.map((assetId) => ({
              snapshotId: snapshot.id,
              assetId,
            })),
          });
        }
        if (snapshot.evidenceIds.length) {
          await tx.snapshotEvidence.createMany({
            data: snapshot.evidenceIds.map((anchorId) => ({
              snapshotId: snapshot.id,
              anchorId,
            })),
          });
        }
        if (snapshot.observationIds.length) {
          await tx.snapshotObservations.createMany({
            data: snapshot.observationIds.map((observationId) => ({
              snapshotId: snapshot.id,
              observationId,
            })),
          });
        }
        if (snapshot.checkIds.length) {
          await tx.snapshotChecks.createMany({
            data: snapshot.checkIds.map((checkId) => ({
              snapshotId: snapshot.id,
              checkId,
            })),
          });
        }
      } else {
        const existing = await tx.analysisSnapshots.findFirst({
          select: { ownerId: true, recordId: true, content: true },
          where: { id: snapshot.id },
        });
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
      await tx.analysisRuns.create({
        data: {
          id: run.id,
          ownerId,
          recordId: run.recordId,
          jobId: run.jobId,
          snapshotId: snapshot.id,
          status: run.status,
          requestedModelId: run.modelSelection.modelId,
          modelSelection: jsonValue(run.modelSelection),
          profileVersion: run.modelSelection.profileVersion,
          promptVersion: 'pending',
          schemaVersion: 'pending',
        },
      });
      if (run.suggestedMethodVersions.length) {
        await tx.runSuggestedMethods.createMany({
          data: run.suggestedMethodVersions.map((method) => ({
            runId: run.id,
            ...method,
          })),
        });
      }
    },

    async setStatus(id, expectedStatuses, status) {
      const mutableStatuses = expectedStatuses.filter(
        (value) => value === 'queued' || value === 'running',
      );
      if (!mutableStatuses.length) {
        return false;
      }
      const completed =
        status === 'failed' || status === 'completed' || status === 'partial'
          ? Prisma.sql`, completed_at = now()`
          : Prisma.empty;
      const [changed] = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        update analysis_runs set status = ${status} ${completed}
        where id = ${id}::uuid and owner_id = ${ownerId} and status in (${Prisma.join(mutableStatuses)}) returning id
      `);

      return Boolean(changed);
    },

    async bindRetrievalSnapshot(runId, input, snapshot) {
      if (input.retrievalSnapshotId !== snapshot.id) {
        throw new Error('Retrieval snapshot ID mismatch');
      }
      const run = await tx.analysisRuns.findFirst({
        select: { id: true, input: true },
        where: { id: runId, ownerId },
      });
      if (!run || run.input !== null) {
        return false;
      }
      await tx.$executeRaw(Prisma.sql`
        insert into retrieval_snapshots (id, owner_id, index_version_id, immutable_pack, content_hash, created_at)
        values (${snapshot.id}::uuid, ${ownerId}, null, ${JSON.stringify(snapshot)}::jsonb,
          ${hash(snapshot)}, ${snapshot.createdAt}::timestamptz)
      `);
      const { count: bound } = await tx.analysisRuns.updateMany({
        data: {
          input: jsonValue(input),
          retrievalSnapshotId: snapshot.id,
          promptVersion: input.promptVersion,
          schemaVersion: input.schemaVersion,
        },
        where: { id: runId, ownerId, input: { equals: Prisma.DbNull } },
      });
      if (!bound) {
        await tx.retrievalSnapshots.deleteMany({ where: { id: snapshot.id } });
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
      const [changed] = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        update analysis_runs set failure_audits = failure_audits || ${JSON.stringify([audit])}::jsonb,
          audit = ${audit.invocation === null ? null : JSON.stringify(audit.invocation)}::jsonb,
          effective_model_id = ${audit.invocation?.effectiveModelId ?? null},
          provider_version = ${audit.invocation?.providerModelVersion ?? null}
        where id = ${id}::uuid and owner_id = ${ownerId} and status in ('queued', 'running') returning id
      `);

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
      const [run] = await tx.$queryRaw<
        Array<{ recordId: string; createdAt: string }>
      >(Prisma.sql`
        update analysis_runs set raw_output = ${JSON.stringify(output)}::jsonb, audit = ${JSON.stringify(invocation)}::jsonb,
          effective_model_id = ${invocation.effectiveModelId}, provider_version = ${invocation.providerModelVersion},
          status = ${status}, completed_at = now()
        where id = ${id}::uuid and owner_id = ${ownerId} and raw_output is null
        returning record_id as "recordId", created_at::text as "createdAt"
      `);
      if (!run) {
        throw new Error('Analysis output is already saved or inaccessible');
      }
      if (suggestedMethodVersions.length) {
        await tx.runSuggestedMethods.createMany({
          data: suggestedMethodVersions.map((method) => ({
            runId: id,
            ...method,
          })),
        });
      }
      if (output.findings.length) {
        await tx.claims.createMany({
          data: output.findings.map((finding) => ({
            id: finding.id,
            runId: id,
            kind: finding.kind,
            text: finding.text,
            relation: finding.relation,
            certainty: finding.certainty,
          })),
        });
      }
      for (const finding of output.findings) {
        if (finding.evidenceIds.length) {
          await tx.claimEvidence.createMany({
            data: finding.evidenceIds.map((anchorId) => ({
              claimId: finding.id,
              anchorId,
            })),
          });
        }
        if (finding.observationIds.length) {
          await tx.claimObservations.createMany({
            data: finding.observationIds.map((observationId) => ({
              claimId: finding.id,
              observationId,
            })),
          });
        }
        if (finding.citationIds.length) {
          await tx.claimCitations.createMany({
            data: finding.citationIds.map((citationId) => ({
              claimId: finding.id,
              citationId,
            })),
          });
        }
      }
      if (output.nextActions.length) {
        await tx.nextActions.createMany({
          data: output.nextActions.map((action) => ({
            id: action.id,
            runId: id,
            recordId: run.recordId,
            kind: action.kind,
            instruction: action.instruction,
            reason: action.reason,
            checkId: action.checkId,
          })),
        });
        await tx.actionStates.createMany({
          data: output.nextActions.map((action) => ({
            runId: id,
            actionId: action.id,
            recordId: run.recordId,
            status: 'pending',
          })),
        });
      }
      if (output.proposedChanges.length) {
        await tx.proposals.createMany({
          data: output.proposedChanges.map((proposal) => ({
            id: proposal.id,
            runId: id,
            field: proposal.field,
            before: jsonValue(proposal.before),
            proposed: jsonValue(proposal.proposed),
          })),
        });
        await tx.proposalStates.createMany({
          data: output.proposedChanges.map((proposal) => ({
            runId: id,
            proposalId: proposal.id,
            status: 'pending',
          })),
        });
        for (const proposal of output.proposedChanges) {
          if (proposal.findingIds.length) {
            await tx.proposalFindings.createMany({
              data: proposal.findingIds.map((claimId) => ({
                proposalId: proposal.id,
                claimId,
              })),
            });
          }
        }
      }
      // request order, including the UUID tie-breaker, survives out-of-order completion
      await tx.$executeRaw(Prisma.sql`
        update records set latest_run_id = ${id}::uuid
        where id = ${run.recordId}::uuid and owner_id = ${ownerId}
          and (latest_run_id is null or exists (
            select 1 from analysis_runs previous where previous.id = records.latest_run_id
              and previous.owner_id = ${ownerId} and previous.record_id = ${run.recordId}::uuid
              and (previous.created_at, previous.id) <= (${run.createdAt}::timestamptz, ${id}::uuid)
          ))
      `);
    },

    async getActionState(runId, actionId): Promise<ActionState | null> {
      const row = await tx.actionStates.findFirst({
        where: { runId, actionId, analysisRuns: { ownerId } },
      });

      return row
        ? {
            runId,
            actionId,
            recordId: row.recordId,
            revision: row.revision,
            status: row.status as ActionState['status'],
            latestResolutionId: row.latestResolutionId,
            updatedAt: new Date(row.updatedAt).toISOString(),
          }
        : null;
    },

    async updateActionState(state, expectedRevision, resolution) {
      const [changed] = await tx.$queryRaw<Array<{ runId: string }>>(Prisma.sql`
        update action_states set revision = ${resolution.actionRevision}, status = ${resolution.status},
          latest_resolution_id = ${resolution.id}::uuid, updated_at = ${resolution.resolvedAt}::timestamptz
        where run_id = ${state.runId}::uuid and action_id = ${state.actionId}::uuid
          and record_id = ${state.recordId}::uuid and revision = ${expectedRevision}
          and exists (select 1 from analysis_runs where id = ${state.runId}::uuid and owner_id = ${ownerId})
        returning run_id as "runId"
      `);
      if (!changed) {
        return false;
      }
      await tx.$executeRaw(Prisma.sql`
        insert into action_resolutions (id, run_id, action_id, action_revision, record_revision,
          status, reason, on_site_description, created_at)
        values (${resolution.id}::uuid, ${resolution.runId}::uuid, ${resolution.actionId}::uuid,
          ${resolution.actionRevision}, ${resolution.recordRevision}, ${resolution.status}, ${resolution.reason},
          ${resolution.support.onSiteDescription ?? null}, ${resolution.resolvedAt}::timestamptz)
      `);
      if (resolution.support.evidenceAnchorIds?.length) {
        await tx.resolutionEvidence.createMany({
          data: resolution.support.evidenceAnchorIds.map((anchorId) => ({
            resolutionId: resolution.id,
            anchorId,
          })),
        });
      }
      if (resolution.support.observationIds?.length) {
        await tx.resolutionObservations.createMany({
          data: resolution.support.observationIds.map((observationId) => ({
            resolutionId: resolution.id,
            observationId,
          })),
        });
      }
      if (resolution.support.referenceLinkIds?.length) {
        await tx.resolutionReferences.createMany({
          data: resolution.support.referenceLinkIds.map((referenceId) => ({
            resolutionId: resolution.id,
            referenceId,
          })),
        });
      }
      if (resolution.support.checkIds?.length) {
        await tx.resolutionChecks.createMany({
          data: resolution.support.checkIds.map((checkId) => ({
            resolutionId: resolution.id,
            checkId,
          })),
        });
      }

      return true;
    },

    async getProposalStates(runId): Promise<readonly ProposalState[]> {
      const rows = await tx.proposalStates.findMany({
        where: { runId, analysisRuns: { ownerId } },
      });

      return rows.map((row) => ({
        proposalId: row.proposalId,
        status: row.status as ProposalState['status'],
        latestAdoptionEventId: row.latestEventId,
      }));
    },

    async appendAdoption(runId, proposalId, status, eventId) {
      const run = await tx.analysisRuns.findFirst({
        select: { recordId: true },
        where: { id: runId, ownerId },
      });
      if (!run) {
        throw new Error('Analysis run not found');
      }
      const record = await tx.records.findFirst({
        select: { recordRevision: true },
        where: { id: run.recordId, ownerId },
      });
      if (!record) {
        throw new Error('Record not found');
      }
      await tx.adoptionEvents.create({
        data: {
          id: eventId,
          runId,
          proposalId,
          status,
          recordRevision: record.recordRevision,
        },
      });
      const { count: changed } = await tx.proposalStates.updateMany({
        data: { status, latestEventId: eventId },
        where: { runId, proposalId, status: 'pending' },
      });
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
      const actionAtCursor =
        cursor?.kind === 'recordCheck'
          ? Prisma.sql`or (state.updated_at = ${cursor.updatedAt}::timestamptz and state.action_id = ${cursor.id}::uuid)`
          : Prisma.empty;
      const actionAfter = cursor
        ? Prisma.sql`and (state.updated_at < ${cursor.updatedAt}::timestamptz
            or (state.updated_at = ${cursor.updatedAt}::timestamptz and state.action_id < ${cursor.id}::uuid)
            ${actionAtCursor})`
        : Prisma.empty;
      const checkAfter = cursor
        ? Prisma.sql`and (check_row.updated_at < ${cursor.updatedAt}::timestamptz
            or (check_row.updated_at = ${cursor.updatedAt}::timestamptz and check_row.id < ${cursor.id}::uuid))`
        : Prisma.empty;
      const actionRows = await tx.$queryRaw<
        Array<
          Omit<actionStates, 'updatedAt'> & {
            updatedAt: string;
            nextAction: Pick<
              nextActions,
              'id' | 'kind' | 'instruction' | 'reason' | 'checkId'
            >;
          }
        >
      >(Prisma.sql`
        select state.run_id as "runId", state.action_id as "actionId", state.record_id as "recordId",
          state.revision, state.status, state.latest_resolution_id as "latestResolutionId", state.updated_at::text as "updatedAt",
          jsonb_build_object('id', action.id, 'kind', action.kind, 'instruction', action.instruction,
            'reason', action.reason, 'checkId', action.check_id) as "nextAction"
        from action_states state
        inner join next_actions action on state.run_id = action.run_id and state.action_id = action.id
        inner join analysis_runs run on state.run_id = run.id and run.owner_id = ${ownerId}
        where state.status = ${query.actionStatus || 'pending'}
          ${query.recordId ? Prisma.sql`and state.record_id = ${query.recordId}::uuid` : Prisma.empty}
          ${actionAfter}
        order by state.updated_at desc, state.action_id desc limit ${limit + 1}
      `);
      const checkRows = await tx.$queryRaw<
        Array<{ id: string; recordId: string; updatedAt: string }>
      >(Prisma.sql`
        select check_row.id, check_row.record_id as "recordId", check_row.updated_at::text as "updatedAt"
        from record_checks check_row where check_row.owner_id = ${ownerId}
          ${query.recordId ? Prisma.sql`and check_row.record_id = ${query.recordId}::uuid` : Prisma.empty}
          and check_row.progress <> 'recorded' ${checkAfter}
        order by check_row.updated_at desc, check_row.id desc limit ${limit + 1}
      `);
      const rawTimes = new Map<string, string>([
        ...actionRows.map(
          (row) => [`analysisAction:${row.actionId}`, row.updatedAt] as const,
        ),
        ...checkRows.map(
          (row) => [`recordCheck:${row.id}`, row.updatedAt] as const,
        ),
      ]);
      const evidence = createEvidenceRepository(tx, ownerId);
      const tasks = await Promise.all([
        ...actionRows.map(async (row) => ({
          kind: 'analysisAction' as const,
          recordId: row.recordId,
          runId: row.runId,
          action: {
            id: row.nextAction.id,
            kind: row.nextAction.kind as
              | 'capturePhoto'
              | 'selectVideoFrame'
              | 'describe'
              | 'confirmFeature'
              | 'inspectSource',
            instruction: row.nextAction.instruction,
            reason: row.nextAction.reason,
            checkId: row.nextAction.checkId ?? undefined,
          },
          state: {
            runId: row.runId,
            actionId: row.actionId,
            recordId: row.recordId,
            revision: row.revision,
            status: row.status as ActionState['status'],
            latestResolutionId: row.latestResolutionId,
            updatedAt: new Date(row.updatedAt).toISOString(),
          },
          latestResolution: row.latestResolutionId
            ? getResolution(row.latestResolutionId)
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
