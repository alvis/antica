import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { createDevelopmentModels } from '../../ai/model.js';

import { createDatabase } from '../connection.js';

import { createLinkedAnalysisEvidence } from '../spec/fixtures/analysis-evidence.js';
import { createIsolatedDatabase } from '../spec/fixtures/isolated-database.js';
import { createTransactionPort } from '../transaction.js';

import type {
  AnalysisEvidencePack,
  AnalysisRunRecord,
  ModelFailureAudit,
  RequestedAnalysisSnapshot,
  RetrievalSnapshot,
} from '@antica/application/ports';
import type {
  AnalysisOutput,
  AnalysisInput,
  ActionResolution,
  ModelInvocation,
  RecordDetail,
  RecordFields,
} from '@antica/contracts';
import type {
  Observation,
  SourceMetadata,
  SourceCitation,
} from '@antica/domain';

const databaseUrl = process.env.ANTICA_TEST_DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    'ANTICA_TEST_DATABASE_URL must identify an isolated migrated PostgreSQL database',
  );
}

const now = '2026-10-13T00:00:00.000Z';
const selection = {
  role: 'analysis' as const,
  modelId: 'development:evidence-v1',
  profileVersion: '1',
};
const failureInvocation: ModelInvocation = {
  requestedModelId: selection.modelId,
  effectiveModelId: selection.modelId,
  provider: 'development',
  providerModelVersion: null,
  adapterKind: 'development',
  capabilities: {
    textInput: true,
    imageInput: true,
    audioInput: false,
    structuredOutput: true,
    toolCalling: false,
  },
  role: 'analysis',
  profileVersion: selection.profileVersion,
  promptVersion: 'analysis-prompt-v1',
  schemaVersion: 'analysis-output-v1',
  effectiveOptions: {},
  latencyMs: 1,
  usage: { inputTokens: null, outputTokens: null },
  finishReason: null,
  citationCheck: { valid: true, rejectedReferenceIds: [] },
};

describe('fn:createAnalysisRepository', { timeout: 30_000 }, () => {
  it('should reject adopting a real proposal through a different run without leaving an event', async () => {
    const database = await createIsolatedDatabase();
    const transaction = createTransactionPort(database.db);
    try {
      const firstId = await createQueuedRun(transaction, database.ownerId);
      const initial = await transaction.run(database.ownerId, async (unit) => ({
        success: true as const,
        data: await unit.analyses.get(firstId),
      }));
      const second = await queueFollowupRun(
        transaction,
        database.ownerId,
        initial.data!,
      );
      const output: AnalysisOutput = {
        summary: 'Proposed description',
        findings: [],
        uncertainties: [],
        suggestedMethodIds: [],
        nextActions: [],
        proposedChanges: [
          {
            id: randomUUID(),
            field: 'description',
            before: 'Frozen collector description',
            proposed: 'Reviewed description',
            findingIds: [],
          },
        ],
      };
      const proposals = await transaction.run(
        database.ownerId,
        async (unit) => {
          await unit.analyses.saveOutput(
            firstId,
            output,
            [],
            failureInvocation,
            'completed',
          );
          await unit.analyses.saveOutput(
            second.id,
            output,
            [],
            failureInvocation,
            'completed',
          );

          return {
            success: true as const,
            data: {
              first: await unit.analyses.getProposalStates(firstId),
              second: await unit.analyses.getProposalStates(second.id),
            },
          };
        },
      );
      await expect(
        transaction.run(database.ownerId, async (unit) => {
          await unit.analyses.appendAdoption(
            firstId,
            proposals.data.second[0]!.proposalId,
            'accepted',
            randomUUID(),
          );

          return { success: true as const, data: undefined };
        }),
      ).rejects.toThrow();
      const unchanged = await transaction.run(
        database.ownerId,
        async (unit) => ({
          success: true as const,
          data: {
            first: await unit.analyses.getProposalStates(firstId),
            second: await unit.analyses.getProposalStates(second.id),
          },
        }),
      );
      expect(unchanged.data).toEqual(proposals.data);
      expect(await database.db.adoptionEvents.findMany({})).toEqual([]);
    } finally {
      await database.close();
    }
  });

  it('should reject a proposal that imports a finding from a different persisted run', async () => {
    const database = await createIsolatedDatabase();
    const transaction = createTransactionPort(database.db);
    try {
      const firstId = await createQueuedRun(transaction, database.ownerId);
      const output: AnalysisOutput = {
        summary: 'Prior hypothesis',
        findings: [
          {
            id: randomUUID(),
            kind: 'hypothesis',
            text: 'Possible repair',
            evidenceIds: [],
            observationIds: [],
            citationIds: [],
            relation: 'context',
            certainty: 'tentative',
          },
        ],
        uncertainties: [],
        suggestedMethodIds: [],
        nextActions: [],
        proposedChanges: [],
      };
      const saved = await transaction.run(database.ownerId, async (unit) => {
        await unit.analyses.saveOutput(
          firstId,
          output,
          [],
          failureInvocation,
          'completed',
        );

        return {
          success: true as const,
          data: await unit.analyses.get(firstId),
        };
      });
      const first = saved.data!;
      const next = await queueFollowupRun(transaction, database.ownerId, first);
      const crossRunOutput: AnalysisOutput = {
        ...output,
        findings: [],
        proposedChanges: [
          {
            id: randomUUID(),
            field: 'description',
            before: 'Frozen collector description',
            proposed: 'Imported hypothesis',
            findingIds: [first.output!.findings[0]!.id],
          },
        ],
      };
      await expect(
        transaction.run(database.ownerId, async (unit) => {
          await unit.analyses.saveOutput(
            next.id,
            crossRunOutput,
            [],
            failureInvocation,
            'completed',
          );

          return { success: true as const, data: undefined };
        }),
      ).rejects.toThrow();
      const unchanged = await transaction.run(
        database.ownerId,
        async (unit) => ({
          success: true as const,
          data: {
            prior: await unit.analyses.get(firstId),
            next: await unit.analyses.get(next.id),
            record: await unit.records.get(first.recordId),
          },
        }),
      );
      expect(unchanged.data.prior).toEqual(first);
      expect(unchanged.data.next).toEqual(next);
      expect(unchanged.data.record).toMatchObject({
        latestRunId: firstId,
        analysisFreshness: 'current',
      });
    } finally {
      await database.close();
    }
  });

  it('should reject recreating a completed run and roll back its newly queued job', async () => {
    const database = await createIsolatedDatabase();
    const transaction = createTransactionPort(database.db);
    try {
      const originalId = await createQueuedRun(transaction, database.ownerId);
      const output: AnalysisOutput = {
        summary: 'Completed immutable result',
        findings: [],
        uncertainties: [],
        suggestedMethodIds: [],
        nextActions: [],
        proposedChanges: [],
      };
      const completed = await transaction.run(
        database.ownerId,
        async (unit) => {
          await unit.analyses.saveOutput(
            originalId,
            output,
            [],
            failureInvocation,
            'completed',
          );

          return {
            success: true as const,
            data: await unit.analyses.get(originalId),
          };
        },
      );
      const id = randomUUID();
      const jobId = randomUUID();
      await expect(
        transaction.run(database.ownerId, async (unit) => {
          await unit.jobs.create({
            id: jobId,
            kind: 'analysis',
            resourceId: id,
            state: { kind: 'queued' },
            createdAt: now,
            updatedAt: now,
            result: null,
          });
          await unit.analyses.create({ ...completed.data!, id, jobId });

          return { success: true as const, data: undefined };
        }),
      ).rejects.toThrow();
      const unchanged = await transaction.run(
        database.ownerId,
        async (unit) => ({
          success: true as const,
          data: {
            original: await unit.analyses.get(originalId),
            replay: await unit.analyses.get(id),
            job: await unit.jobs.get(jobId),
          },
        }),
      );
      expect(unchanged.data).toEqual({
        original: completed.data,
        replay: null,
        job: null,
      });
    } finally {
      await database.close();
    }
  });

  it('should link completed analysis and keep its immutable result accessible after adoption and reconnect', async () => {
    const database = await createIsolatedDatabase();
    const transaction = createTransactionPort(database.db);
    try {
      const runId = await createQueuedRun(transaction, database.ownerId);
      const initial = await transaction.run(database.ownerId, async (unit) => ({
        success: true as const,
        data: await unit.analyses.get(runId),
      }));
      const run = initial.data!;
      const output: AnalysisOutput = {
        summary: 'Usable result',
        findings: [],
        uncertainties: [],
        suggestedMethodIds: [],
        nextActions: [],
        proposedChanges: [
          {
            id: randomUUID(),
            field: 'description',
            before: 'Frozen collector description',
            proposed: 'Adopted description',
            findingIds: [],
          },
        ],
      };
      const completed = await transaction.run(
        database.ownerId,
        async (unit) => {
          await unit.analyses.saveOutput(
            runId,
            output,
            [],
            failureInvocation,
            'completed',
          );

          return {
            success: true as const,
            data: {
              record: await unit.records.get(run.recordId),
              current: await unit.records.query({ freshness: 'current' }),
              run: await unit.analyses.get(runId),
            },
          };
        },
      );
      expect(completed.data.record).toMatchObject({
        latestRunId: runId,
        analysisFreshness: 'current',
        analysisInputVersion: 1,
      });
      expect(completed.data.current.items).toEqual([
        expect.objectContaining({
          id: run.recordId,
          analysisFreshness: 'current',
        }),
      ]);
      const foreign = await transaction.run(randomUUID(), async (unit) => ({
        success: true as const,
        data: {
          record: await unit.records.get(run.recordId),
          run: await unit.analyses.get(runId),
          page: await unit.records.query({ freshness: 'current' }),
        },
      }));
      expect(foreign.data).toEqual({
        record: null,
        run: null,
        page: { items: [], nextCursor: null },
      });
      const proposalId = completed.data.run!.output!.proposedChanges[0]!.id;
      const adopted = await transaction.run(database.ownerId, async (unit) => {
        const patched = await unit.records.patch(
          run.recordId,
          {
            expectedRevision: 1,
            fields: { description: 'Adopted description' },
          },
          { recordRevision: 2, analysisInputVersion: 2, evidenceVersion: 1 },
        );
        await unit.analyses.appendAdoption(
          runId,
          proposalId,
          'accepted',
          randomUUID(),
        );

        return {
          success: true as const,
          data: {
            patched,
            outdated: await unit.records.query({ freshness: 'outdated' }),
            current: await unit.records.query({ freshness: 'current' }),
          },
        };
      });
      expect(adopted.data.patched).toMatchObject({
        latestRunId: runId,
        analysisFreshness: 'outdated',
        description: 'Adopted description',
        analysisInputVersion: 2,
      });
      expect(adopted.data.outdated.items).toEqual([
        expect.objectContaining({
          id: run.recordId,
          analysisFreshness: 'outdated',
        }),
      ]);
      expect(adopted.data.current.items).toEqual([]);
      const reopened = createDatabase({ url: database.url, maxConnections: 1 });
      try {
        const persisted = await createTransactionPort(reopened.db).run(
          database.ownerId,
          async (unit) => ({
            success: true as const,
            data: {
              record: await unit.records.get(run.recordId),
              run: await unit.analyses.get(runId),
            },
          }),
        );
        expect(persisted.data.record).toMatchObject({
          latestRunId: runId,
          analysisFreshness: 'outdated',
        });
        expect(persisted.data.run).toEqual(completed.data.run);
      } finally {
        await reopened.close();
      }
    } finally {
      await database.close();
    }
  });

  it('should keep newer partial output linked when older work completes and later work fails', async () => {
    const database = await createIsolatedDatabase();
    const transaction = createTransactionPort(database.db);
    try {
      const oldId = await createQueuedRun(transaction, database.ownerId);
      const initial = await transaction.run(database.ownerId, async (unit) => ({
        success: true as const,
        data: await unit.analyses.get(oldId),
      }));
      const old = initial.data!;
      const newer = await queueFollowupRun(transaction, database.ownerId, old);
      const output: AnalysisOutput = {
        summary: 'Usable partial result',
        findings: [],
        uncertainties: ['More evidence needed'],
        suggestedMethodIds: [],
        nextActions: [],
        proposedChanges: [],
      };
      await transaction.run(database.ownerId, async (unit) => {
        await unit.analyses.saveOutput(
          newer.id,
          output,
          [],
          failureInvocation,
          'partial',
        );

        return { success: true as const, data: undefined };
      });
      const partial = await transaction.run(database.ownerId, async (unit) => ({
        success: true as const,
        data: await unit.records.get(old.recordId),
      }));
      expect(partial.data).toMatchObject({
        latestRunId: newer.id,
        analysisFreshness: 'current',
      });
      await transaction.run(database.ownerId, async (unit) => {
        await unit.analyses.saveOutput(
          old.id,
          { ...output, summary: 'Older completed result' },
          [],
          failureInvocation,
          'completed',
        );

        return { success: true as const, data: undefined };
      });
      const reversed = await transaction.run(
        database.ownerId,
        async (unit) => ({
          success: true as const,
          data: {
            record: await unit.records.get(old.recordId),
            old: await unit.analyses.get(old.id),
            newer: await unit.analyses.get(newer.id),
          },
        }),
      );
      expect(reversed.data.record).toMatchObject({
        latestRunId: newer.id,
        analysisFreshness: 'current',
      });
      expect(reversed.data.old).toMatchObject({
        status: 'completed',
        output: { ...output, summary: 'Older completed result' },
      });
      expect(reversed.data.newer).toMatchObject({ status: 'partial', output });
      const pending = await queueFollowupRun(
        transaction,
        database.ownerId,
        old,
      );
      const statuses = await transaction.run(database.ownerId, async (unit) => {
        const queued = await unit.records.get(old.recordId);
        const running = await unit.analyses.setStatus(
          pending.id,
          ['queued'],
          'running',
        );
        const whileRunning = await unit.records.get(old.recordId);
        const failed = await unit.analyses.setStatus(
          pending.id,
          ['running'],
          'failed',
        );
        const afterFailure = await unit.records.get(old.recordId);

        return {
          success: true as const,
          data: { queued, running, whileRunning, failed, afterFailure },
        };
      });
      expect(statuses.data).toMatchObject({
        running: true,
        failed: true,
        queued: { latestRunId: newer.id, analysisFreshness: 'current' },
        whileRunning: { latestRunId: newer.id, analysisFreshness: 'current' },
        afterFailure: { latestRunId: newer.id, analysisFreshness: 'current' },
      });
    } finally {
      await database.close();
    }
  });

  it('should expose mid-run input changes as outdated until a new snapshot completes', async () => {
    const database = await createIsolatedDatabase();
    const transaction = createTransactionPort(database.db);
    try {
      const runId = await createQueuedRun(transaction, database.ownerId);
      const initial = await transaction.run(database.ownerId, async (unit) => ({
        success: true as const,
        data: await unit.analyses.get(runId),
      }));
      const run = initial.data!;
      const output: AnalysisOutput = {
        summary: 'Frozen original result',
        findings: [],
        uncertainties: [],
        suggestedMethodIds: [],
        nextActions: [],
        proposedChanges: [],
      };
      await transaction.run(database.ownerId, async (unit) => {
        await unit.analyses.setStatus(runId, ['queued'], 'running');
        await unit.records.patch(
          run.recordId,
          {
            expectedRevision: 1,
            fields: { description: 'New evidence description' },
          },
          { recordRevision: 2, analysisInputVersion: 2, evidenceVersion: 1 },
        );
        await unit.analyses.saveOutput(
          runId,
          output,
          [],
          failureInvocation,
          'completed',
        );

        return { success: true as const, data: undefined };
      });
      const stale = await transaction.run(database.ownerId, async (unit) => ({
        success: true as const,
        data: {
          record: await unit.records.get(run.recordId),
          outdated: await unit.records.query({ freshness: 'outdated' }),
          run: await unit.analyses.get(runId),
        },
      }));
      expect(stale.data.record).toMatchObject({
        latestRunId: runId,
        analysisFreshness: 'outdated',
        analysisInputVersion: 2,
      });
      expect(stale.data.outdated.items).toEqual([
        expect.objectContaining({
          id: run.recordId,
          analysisFreshness: 'outdated',
        }),
      ]);
      expect(stale.data.run).toMatchObject({
        output,
        requestedSnapshot: { analysisInputVersion: 1 },
      });
      const refreshed = await queueFollowupRun(transaction, database.ownerId, {
        ...run,
        requestedSnapshot: {
          ...run.requestedSnapshot,
          id: randomUUID(),
          recordRevision: 2,
          analysisInputVersion: 2,
          frozenPack: {
            ...run.requestedSnapshot.frozenPack,
            recordFields: {
              ...run.requestedSnapshot.frozenPack.recordFields,
              description: 'New evidence description',
            },
          },
        },
      });
      const current = await transaction.run(database.ownerId, async (unit) => {
        await unit.analyses.saveOutput(
          refreshed.id,
          { ...output, summary: 'Refreshed result' },
          [],
          failureInvocation,
          'completed',
        );

        return {
          success: true as const,
          data: {
            record: await unit.records.get(run.recordId),
            current: await unit.records.query({ freshness: 'current' }),
            outdated: await unit.records.query({ freshness: 'outdated' }),
            old: await unit.analyses.get(runId),
          },
        };
      });
      expect(current.data.record).toMatchObject({
        latestRunId: refreshed.id,
        analysisFreshness: 'current',
        analysisInputVersion: 2,
      });
      expect(current.data.current.items).toEqual([
        expect.objectContaining({
          id: run.recordId,
          analysisFreshness: 'current',
        }),
      ]);
      expect(current.data.outdated.items).toEqual([]);
      expect(current.data.old).toEqual(stale.data.run);
    } finally {
      await database.close();
    }
  });

  it('should retain frozen evidence, suggested methods and every supplied resolution link', async () => {
    const database = await createIsolatedDatabase();
    const transaction = createTransactionPort(database.db);
    const runId = randomUUID();
    const jobId = randomUUID();
    const sourceId = randomUUID();
    const versionId = randomUUID();
    const referenceId = randomUUID();
    const metadata: SourceMetadata = {
      title: 'Museum catalog',
      contributors: [],
      authorStatus: 'unknown',
      editionStatement: null,
      publisher: null,
      publicationDateAsPrinted: null,
      isbn: null,
      languages: ['en'],
      canonicalUrl: 'https://example.test/catalog',
      access: 'link_only',
      rightsStatement: null,
      attributionText: null,
    };
    const citation: SourceCitation = {
      id: randomUUID(),
      locator: {
        kind: 'web',
        sourceId,
        sourceVersionId: versionId,
        url: 'https://example.test/catalog',
        retrievedAt: now,
        snapshotAssetId: null,
        blockId: null,
        excerptAsRetrieved: 'Repair evidence',
      },
      relation: 'supports',
      availability: 'link_only',
      verification: 'located',
    };
    try {
      const fixture = await transaction.run(database.ownerId, async (unit) => ({
        success: true as const,
        data: await createLinkedAnalysisEvidence(unit),
      }));
      const {
        recordId,
        assetId,
        anchor,
        observation,
        check,
        methodId,
        methodVersionId,
        entryId,
      } = fixture.data;
      const method = {
        methodId,
        methodVersionId,
        owningEntryId: entryId,
        titleZhHant: '檢查',
      };
      const seeded = await transaction.run(database.ownerId, async (unit) => {
        const record = (await unit.records.get(recordId))!;
        const {
          id: _id,
          code: _code,
          recordRevision: _revision,
          analysisInputVersion: _analysis,
          evidenceVersion: _evidence,
          createdAt: _created,
          updatedAt: _updated,
          mediaIds: _mediaIds,
          checkIds: _checks,
          latestRunId: _run,
          analysisFreshness: _freshness,
          ...recordFields
        } = record;
        const snapshot: RequestedAnalysisSnapshot = {
          id: randomUUID(),
          recordId,
          recordRevision: 1,
          analysisInputVersion: 1,
          evidenceVersion: 1,
          assetIds: [assetId],
          evidenceIds: [anchor.id],
          observationIds: [observation.id],
          checkIds: [check.id],
          createdAt: now,
          frozenPack: {
            recordFields,
            media: [(await unit.media.get(assetId))!],
            evidence: [anchor],
            observations: [observation],
            checks: [check],
          },
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
        await unit.analyses.create({
          id: runId,
          jobId,
          recordId,
          requestedSnapshot: snapshot,
          modelSelection: selection,
          input: null,
          retrievalSnapshot: null,
          output: null,
          invocation: null,
          failureAudits: [],
          suggestedMethodVersions: [method],
          status: 'queued',
        });
        await unit.sources.create(
          {
            id: sourceId,
            revision: 1,
            createdAt: now,
            updatedAt: now,
            kind: 'web',
            metadata,
            currentVersionId: versionId,
          },
          {
            id: versionId,
            sourceId,
            originalAssetIds: [],
            sourceHash: 'e'.repeat(64),
            metadataSnapshot: metadata,
            capturedAt: now,
            retrievedAt: now,
            status: 'registered',
            textIndexStatus: 'registered',
            imageIndexStatus: 'registered',
            activeParseRunId: null,
          },
          [],
        );
        await unit.sources.addCitation(citation);
        await unit.research.addReference(
          {
            id: referenceId,
            target: {
              recordId,
              checkId: check.id,
              observationId: null,
              evidenceAnchorId: null,
            },
            reference: {
              kind: 'source',
              locator: citation.locator,
              referenceImageId: null,
            },
            comparisonId: null,
            noteZhHant: '修復證據',
            createdAt: now,
            versions: {
              recordRevision: 1,
              analysisInputVersion: 1,
              evidenceVersion: 1,
            },
          },
          randomUUID(),
        );

        return { success: true as const, data: snapshot };
      });
      const output: AnalysisOutput = {
        summary: 'Repair evidence',
        uncertainties: [],
        suggestedMethodIds: [methodId],
        findings: [
          {
            id: randomUUID(),
            kind: 'hypothesis',
            text: 'Possible repair',
            evidenceIds: [anchor.id],
            observationIds: [],
            citationIds: [citation.id],
            relation: 'supports',
            certainty: 'tentative',
          },
        ],
        nextActions: [
          {
            id: randomUUID(),
            checkId: check.id,
            kind: 'confirmFeature',
            instruction: 'Inspect repair',
            reason: 'Confirm hypothesis',
          },
        ],
        proposedChanges: [],
      };
      const saved = await transaction.run(database.ownerId, async (unit) => {
        await unit.analyses.saveOutput(
          runId,
          output,
          [],
          failureInvocation,
          'partial',
        );

        return { success: true as const, data: await unit.analyses.get(runId) };
      });
      expect(saved.data).toMatchObject({
        suggestedMethodVersions: [method],
        status: 'partial',
      });
      expect(saved.data?.requestedSnapshot).toEqual(seeded.data);
      const claimId = saved.data!.output!.findings[0]!.id;
      expect(
        await database.db.claimEvidence.findMany({
          where: { claimId },
        }),
      ).toEqual([{ claimId, anchorId: anchor.id }]);
      expect(
        await database.db.claimCitations.findMany({
          where: { claimId },
        }),
      ).toEqual([{ claimId, citationId: citation.id }]);
      const repeated = await transaction.run(database.ownerId, async (unit) => {
        const secondId = randomUUID();
        const secondJob = randomUUID();
        await unit.jobs.create({
          id: secondJob,
          kind: 'analysis',
          resourceId: secondId,
          state: { kind: 'queued' },
          createdAt: now,
          updatedAt: now,
          result: null,
        });
        await unit.analyses.create({
          ...saved.data!,
          id: secondId,
          jobId: secondJob,
          input: null,
          retrievalSnapshot: null,
          output: null,
          invocation: null,
          failureAudits: [],
          suggestedMethodVersions: [],
          status: 'queued',
        });
        await unit.analyses.saveOutput(
          secondId,
          { ...output, nextActions: [] },
          [method],
          failureInvocation,
          'completed',
        );

        return {
          success: true as const,
          data: await unit.analyses.get(secondId),
        };
      });
      expect(repeated.data).toMatchObject({
        suggestedMethodVersions: [method],
        status: 'completed',
      });
      expect(repeated.data?.requestedSnapshot).toEqual(seeded.data);
      const actionId = saved.data!.output!.nextActions[0]!.id;
      const state = await transaction.run(database.ownerId, async (unit) => ({
        success: true as const,
        data: await unit.analyses.getActionState(runId, actionId),
      }));
      const resolution: ActionResolution = {
        id: randomUUID(),
        runId,
        actionId,
        recordId,
        actionRevision: 2,
        status: 'supplied',
        support: {
          evidenceAnchorIds: [anchor.id],
          observationIds: [observation.id],
          referenceLinkIds: [referenceId],
          checkIds: [check.id],
        },
        reason: null,
        resolvedBy: 'collector',
        resolvedAt: now,
        recordRevision: 1,
      };
      await transaction.run(database.ownerId, async (unit) => ({
        success: true as const,
        data: await unit.analyses.updateActionState(state.data!, 1, resolution),
      }));
      const pendingCheck = {
        ...check,
        revision: 2,
        updatedAt: '2026-10-13T00:00:01.000Z',
      };
      await transaction.run(database.ownerId, async (unit) => ({
        success: true as const,
        data: await unit.evidence.updateCheck(pendingCheck, 1),
      }));
      // IDs are unique per entity table; the merged task cursor must also retain kind.
      const tiedCheck = {
        ...check,
        id: actionId,
        componentIds: [],
        observationIds: [],
        evidenceAnchorIds: [],
      };
      await transaction.run(database.ownerId, async (unit) => {
        await unit.evidence.addCheck(tiedCheck);

        return { success: true as const, data: undefined };
      });
      const tasks = await transaction.run(database.ownerId, async (unit) => ({
        success: true as const,
        data: await unit.analyses.queryTasks({
          recordId,
          actionStatus: 'supplied',
          limit: 1,
        }),
      }));
      expect(tasks.data.items).toHaveLength(1);
      expect(tasks.data.nextCursor).toEqual(expect.any(String));
      const tail = await transaction.run(database.ownerId, async (unit) => ({
        success: true as const,
        data: await unit.analyses.queryTasks({
          recordId,
          actionStatus: 'supplied',
          limit: 1,
          cursor: tasks.data.nextCursor!,
        }),
      }));
      expect(tail.data.items).toEqual([
        { kind: 'recordCheck', recordId, check: tiedCheck },
      ]);
      expect(tail.data.nextCursor).toEqual(expect.any(String));
      const final = await transaction.run(database.ownerId, async (unit) => ({
        success: true as const,
        data: await unit.analyses.queryTasks({
          recordId,
          actionStatus: 'supplied',
          limit: 1,
          cursor: tail.data.nextCursor!,
        }),
      }));
      const all = [
        ...tasks.data.items,
        ...tail.data.items,
        ...final.data.items,
      ];
      expect(all).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kind: 'recordCheck', check: pendingCheck }),
          expect.objectContaining({
            kind: 'analysisAction',
            latestResolution: {
              ...resolution,
              support: { ...resolution.support, onSiteDescription: undefined },
            },
          }),
        ]),
      );
      expect(final.data.nextCursor).toBeNull();
    } finally {
      await database.close();
    }
  });

  it('should retain only one retrieval snapshot when two bindings contend', async () => {
    const database = await createIsolatedDatabase();
    const transaction = createTransactionPort(database.db);
    try {
      const runId = await createQueuedRun(transaction, database.ownerId);
      const initial = await transaction.run(database.ownerId, async (unit) => ({
        success: true as const,
        data: await unit.analyses.get(runId),
      }));
      const run = initial.data!;
      const first: RetrievalSnapshot = {
        id: randomUUID(),
        index: {
          embeddingModelId: 'development:text',
          dimensions: 8,
          indexVersion: '1',
        },
        citations: [],
        text: [],
        methods: [],
        createdAt: now,
      };
      const second: RetrievalSnapshot = { ...first, id: randomUUID() };
      const input: AnalysisInput = {
        recordId: run.recordId,
        snapshotId: run.requestedSnapshot.id,
        recordRevision: 1,
        analysisInputVersion: 1,
        evidenceVersion: 1,
        assetIds: [],
        evidenceIds: [],
        observationIds: [],
        checkIds: [],
        retrievalSnapshotId: first.id,
        promptVersion: 'analysis-prompt-v1',
        schemaVersion: 'analysis-output-v1',
      };
      const result = await transaction.run(database.ownerId, async (unit) => ({
        success: true as const,
        data: await Promise.all([
          unit.analyses.bindRetrievalSnapshot(runId, input, first),
          unit.analyses.bindRetrievalSnapshot(
            runId,
            { ...input, retrievalSnapshotId: second.id },
            second,
          ),
        ]),
      }));
      expect(result.data.filter(Boolean)).toHaveLength(1);
      const winner = result.data[0] ? first : second;
      const stored = await transaction.run(database.ownerId, async (unit) => ({
        success: true as const,
        data: await unit.analyses.get(runId),
      }));
      expect(stored.data).toMatchObject({
        retrievalSnapshot: winner,
        input: { ...input, retrievalSnapshotId: winner.id },
      });
      expect(
        await database.db.retrievalSnapshots.findMany({ select: { id: true } }),
      ).toEqual([{ id: winner.id }]);
    } finally {
      await database.close();
    }
  });

  it('should reject a reused snapshot identity with different frozen content', async () => {
    const database = await createIsolatedDatabase();
    const transaction = createTransactionPort(database.db);
    try {
      const runId = await createQueuedRun(transaction, database.ownerId);
      const initial = await transaction.run(database.ownerId, async (unit) => ({
        success: true as const,
        data: await unit.analyses.get(runId),
      }));
      const run = initial.data!;
      await expect(
        transaction.run(database.ownerId, async (unit) => {
          const conflictingRunId = randomUUID();
          const conflictingJobId = randomUUID();
          await unit.jobs.create({
            id: conflictingJobId,
            kind: 'analysis',
            resourceId: conflictingRunId,
            state: { kind: 'queued' },
            createdAt: now,
            updatedAt: now,
            result: null,
          });
          await unit.analyses.create({
            ...run,
            id: conflictingRunId,
            jobId: conflictingJobId,
            requestedSnapshot: {
              ...run.requestedSnapshot,
              frozenPack: {
                ...run.requestedSnapshot.frozenPack,
                recordFields: {
                  ...run.requestedSnapshot.frozenPack.recordFields,
                  description: 'Changed frozen data',
                },
              },
            },
          });

          return { success: true as const, data: undefined };
        }),
      ).rejects.toThrow();
      const unchanged = await transaction.run(
        database.ownerId,
        async (unit) => ({
          success: true as const,
          data: await unit.analyses.getBySnapshotId(run.requestedSnapshot.id),
        }),
      );
      expect(unchanged.data).toEqual(run);
    } finally {
      await database.close();
    }
  });

  it('should reject duplicate generated identities before saving any model output', async () => {
    const database = await createIsolatedDatabase();
    const transaction = createTransactionPort(database.db);
    try {
      const runId = await createQueuedRun(transaction, database.ownerId);
      const finding: AnalysisOutput['findings'][number] = {
        id: randomUUID(),
        kind: 'hypothesis',
        text: 'Needs investigation',
        evidenceIds: [],
        observationIds: [],
        citationIds: [],
        relation: 'context',
        certainty: 'tentative',
      };
      const action: AnalysisOutput['nextActions'][number] = {
        id: randomUUID(),
        kind: 'describe',
        instruction: 'Describe base',
        reason: 'Missing context',
      };
      const proposal: AnalysisOutput['proposedChanges'][number] = {
        id: randomUUID(),
        field: 'description',
        before: '',
        proposed: 'Tentative description',
        findingIds: [finding.id],
      };
      const base: AnalysisOutput = {
        summary: '',
        findings: [finding],
        nextActions: [action],
        proposedChanges: [proposal],
        uncertainties: [],
        suggestedMethodIds: [],
      };
      for (const output of [
        { ...base, findings: [finding, finding] },
        { ...base, nextActions: [action, action] },
        { ...base, proposedChanges: [proposal, proposal] },
      ]) {
        await expect(
          transaction.run(database.ownerId, async (unit) => {
            await unit.analyses.saveOutput(
              runId,
              output,
              [],
              failureInvocation,
              'completed',
            );

            return { success: true as const, data: undefined };
          }),
        ).rejects.toThrow();
      }
      const unchanged = await transaction.run(
        database.ownerId,
        async (unit) => ({
          success: true as const,
          data: await unit.analyses.get(runId),
        }),
      );
      expect(unchanged.data).toMatchObject({
        output: null,
        status: 'queued',
        invocation: null,
      });
    } finally {
      await database.close();
    }
  });

  it('should persist nullable proposal values as immutable JSON values', async () => {
    const database = await createIsolatedDatabase();
    const transaction = createTransactionPort(database.db);
    try {
      const runId = await createQueuedRun(transaction, database.ownerId);
      const output: AnalysisOutput = {
        summary: 'Tentative identification',
        findings: [],
        uncertainties: [],
        suggestedMethodIds: [],
        nextActions: [],
        proposedChanges: [
          {
            id: randomUUID(),
            field: 'name',
            before: null,
            proposed: 'Vase',
            findingIds: [],
          },
          {
            id: randomUUID(),
            field: 'collectorJudgment',
            before: 'Unverified',
            proposed: null,
            findingIds: [],
          },
        ],
      };
      const saved = await transaction.run(database.ownerId, async (unit) => {
        await unit.analyses.saveOutput(
          runId,
          output,
          [],
          failureInvocation,
          'completed',
        );

        return { success: true as const, data: await unit.analyses.get(runId) };
      });
      expect(saved.data?.output?.proposedChanges).toEqual(
        output.proposedChanges.map((proposal) => ({
          ...proposal,
          id: expect.any(String),
        })),
      );
      const normalized = await database.db.proposals.findMany({
        select: { field: true, before: true, proposed: true },
        where: { runId },
      });
      expect(normalized).toEqual(
        expect.arrayContaining([
          { field: 'name', before: null, proposed: 'Vase' },
          { field: 'collectorJudgment', before: 'Unverified', proposed: null },
        ]),
      );
    } finally {
      await database.close();
    }
  });

  it('should paginate pending actions and persist resolution and adoption without allowing replay', async () => {
    const database = await createIsolatedDatabase();
    const transaction = createTransactionPort(database.db);
    try {
      const runId = await createQueuedRun(transaction, database.ownerId);
      const output: AnalysisOutput = {
        summary: 'Needs inspection',
        findings: [],
        uncertainties: [],
        suggestedMethodIds: [],
        nextActions: [
          {
            id: randomUUID(),
            kind: 'describe',
            instruction: 'Describe the base',
            reason: 'Missing description',
          },
          {
            id: randomUUID(),
            kind: 'capturePhoto',
            instruction: 'Photograph the base',
            reason: 'Missing image',
          },
        ],
        proposedChanges: [
          {
            id: randomUUID(),
            field: 'description',
            before: 'Frozen collector description',
            proposed: 'Vase',
            findingIds: [],
          },
        ],
      };
      const saved = await transaction.run(database.ownerId, async (unit) => {
        await unit.analyses.saveOutput(
          runId,
          output,
          [],
          failureInvocation,
          'completed',
        );

        return { success: true as const, data: await unit.analyses.get(runId) };
      });
      const run = saved.data!;
      const scoped = run.output!;
      const first = await transaction.run(database.ownerId, async (unit) => ({
        success: true as const,
        data: await unit.analyses.queryTasks({
          recordId: run.recordId,
          limit: 1,
        }),
      }));
      expect(first.data.items).toHaveLength(1);
      expect(first.data.nextCursor).toEqual(expect.any(String));
      const second = await transaction.run(database.ownerId, async (unit) => ({
        success: true as const,
        data: await unit.analyses.queryTasks({
          recordId: run.recordId,
          limit: 1,
          cursor: first.data.nextCursor!,
        }),
      }));
      expect(second.data.nextCursor).toBeNull();
      expect(
        [...first.data.items, ...second.data.items].map((task) =>
          task.kind === 'analysisAction' ? task.action.id : task.check.id,
        ),
      ).toEqual(
        scoped.nextActions
          .map((action) => action.id)
          .sort()
          .reverse(),
      );
      await expect(
        transaction.run(database.ownerId, async (unit) => ({
          success: true as const,
          data: await unit.analyses.queryTasks({
            recordId: run.recordId,
            actionStatus: 'supplied',
            cursor: first.data.nextCursor!,
          }),
        })),
      ).rejects.toThrow();
      const actionId = scoped.nextActions[0]!.id;
      const initial = await transaction.run(database.ownerId, async (unit) => ({
        success: true as const,
        data: await unit.analyses.getActionState(runId, actionId),
      }));
      const state = initial.data!;
      const resolution: ActionResolution = {
        id: randomUUID(),
        runId,
        actionId,
        recordId: run.recordId,
        actionRevision: 2,
        status: 'supplied',
        support: { onSiteDescription: 'Unglazed foot' },
        reason: null,
        resolvedBy: 'collector',
        resolvedAt: now,
        recordRevision: 1,
      };
      const foreign = await transaction.run(randomUUID(), async (unit) => ({
        success: true as const,
        data: {
          action: await unit.analyses.getActionState(runId, actionId),
          proposals: await unit.analyses.getProposalStates(runId),
          changed: await unit.analyses.updateActionState(state, 1, resolution),
          tasks: await unit.analyses.queryTasks({}),
        },
      }));
      expect(foreign.data).toEqual({
        action: null,
        proposals: [],
        changed: false,
        tasks: { items: [], nextCursor: null },
      });
      const resolved = await transaction.run(
        database.ownerId,
        async (unit) => ({
          success: true as const,
          data: {
            changed: await unit.analyses.updateActionState(
              state,
              1,
              resolution,
            ),
            replay: await unit.analyses.updateActionState(state, 1, {
              ...resolution,
              id: randomUUID(),
            }),
            tasks: await unit.analyses.queryTasks({ actionStatus: 'supplied' }),
          },
        }),
      );
      expect(resolved.data).toEqual({
        changed: true,
        replay: false,
        tasks: {
          items: [
            {
              kind: 'analysisAction',
              recordId: run.recordId,
              runId,
              action: scoped.nextActions[0],
              state: {
                ...state,
                revision: 2,
                status: 'supplied',
                latestResolutionId: resolution.id,
                updatedAt: now,
              },
              latestResolution: {
                ...resolution,
                support: {
                  ...resolution.support,
                  evidenceAnchorIds: [],
                  observationIds: [],
                  referenceLinkIds: [],
                  checkIds: [],
                },
              },
            },
          ],
          nextCursor: null,
        },
      });
      const foreignRunId = await createQueuedRun(transaction, randomUUID());
      const persistedResolution =
        await database.db.actionResolutions.findUniqueOrThrow({
          where: { id: resolution.id },
        });
      const foreignResolutionId = randomUUID();
      await database.db.actionResolutions.create({
        data: {
          ...persistedResolution,
          id: foreignResolutionId,
          runId: foreignRunId,
        },
      });
      for (const unavailableResolutionId of [
        randomUUID(),
        foreignResolutionId,
      ]) {
        await database.db.actionStates.updateMany({
          where: { runId, actionId },
          data: { latestResolutionId: unavailableResolutionId },
        });
        const unavailable = await transaction.run(
          database.ownerId,
          async (unit) => ({
            success: true as const,
            data: await unit.analyses.queryTasks({ actionStatus: 'supplied' }),
          }),
        );
        expect(unavailable.data.items).toEqual([
          expect.objectContaining({
            kind: 'analysisAction',
            latestResolution: null,
          }),
        ]);
      }
      await database.db.actionStates.updateMany({
        where: { runId, actionId },
        data: { latestResolutionId: resolution.id },
      });
      const proposalId = scoped.proposedChanges[0]!.id;
      const eventId = randomUUID();
      const adoption = await transaction.run(database.ownerId, async (unit) => {
        await unit.analyses.appendAdoption(
          runId,
          proposalId,
          'accepted',
          eventId,
        );

        return {
          success: true as const,
          data: await unit.analyses.getProposalStates(runId),
        };
      });
      expect(adoption.data).toEqual([
        { proposalId, status: 'accepted', latestAdoptionEventId: eventId },
      ]);
      await expect(
        transaction.run(database.ownerId, async (unit) => {
          await unit.analyses.appendAdoption(
            runId,
            proposalId,
            'skipped',
            randomUUID(),
          );

          return { success: true as const, data: undefined };
        }),
      ).rejects.toThrow();
      await expect(
        transaction.run(randomUUID(), async (unit) => {
          await unit.analyses.appendAdoption(
            runId,
            proposalId,
            'accepted',
            randomUUID(),
          );

          return { success: true as const, data: undefined };
        }),
      ).rejects.toThrow();
      await expect(
        transaction.run(database.ownerId, async (unit) => {
          await unit.analyses.saveOutput(
            runId,
            output,
            [],
            failureInvocation,
            'completed',
          );

          return { success: true as const, data: undefined };
        }),
      ).rejects.toThrow();
      const unchanged = await transaction.run(
        database.ownerId,
        async (unit) => ({
          success: true as const,
          data: {
            run: await unit.analyses.get(runId),
            proposals: await unit.analyses.getProposalStates(runId),
          },
        }),
      );
      expect(unchanged.data).toEqual({ run, proposals: adoption.data });
    } finally {
      await database.close();
    }
  });

  it('should bind retrieval once, isolate snapshot lookup and prevent terminal status replay', async () => {
    const database = await createIsolatedDatabase();
    const transaction = createTransactionPort(database.db);
    try {
      const runId = await createQueuedRun(transaction, database.ownerId);
      const initial = await transaction.run(database.ownerId, async (unit) => ({
        success: true as const,
        data: await unit.analyses.get(runId),
      }));
      const run = initial.data!;
      const snapshot = run.requestedSnapshot;
      const retrieval: RetrievalSnapshot = {
        id: randomUUID(),
        index: {
          embeddingModelId: 'development:text',
          dimensions: 8,
          indexVersion: '1',
        },
        citations: [],
        text: [],
        methods: [],
        createdAt: now,
      };
      const input: AnalysisInput = {
        recordId: run.recordId,
        snapshotId: snapshot.id,
        recordRevision: 1,
        analysisInputVersion: 1,
        evidenceVersion: 1,
        assetIds: [],
        evidenceIds: [],
        observationIds: [],
        checkIds: [],
        retrievalSnapshotId: retrieval.id,
        promptVersion: 'analysis-prompt-v1',
        schemaVersion: 'analysis-output-v1',
      };
      const foreign = await transaction.run(randomUUID(), async (unit) => ({
        success: true as const,
        data: {
          snapshot: await unit.analyses.getBySnapshotId(snapshot.id),
          bound: await unit.analyses.bindRetrievalSnapshot(
            runId,
            input,
            retrieval,
          ),
          status: await unit.analyses.setStatus(runId, ['queued'], 'running'),
        },
      }));
      expect(foreign.data).toEqual({
        snapshot: null,
        bound: false,
        status: false,
      });
      await expect(
        transaction.run(database.ownerId, async (unit) => ({
          success: true as const,
          data: await unit.analyses.bindRetrievalSnapshot(
            runId,
            { ...input, retrievalSnapshotId: randomUUID() },
            retrieval,
          ),
        })),
      ).rejects.toThrow();
      const changed = await transaction.run(database.ownerId, async (unit) => ({
        success: true as const,
        data: {
          bound: await unit.analyses.bindRetrievalSnapshot(
            runId,
            input,
            retrieval,
          ),
          replay: await unit.analyses.bindRetrievalSnapshot(
            runId,
            input,
            retrieval,
          ),
          terminalExpected: await unit.analyses.setStatus(
            runId,
            ['completed'],
            'running',
          ),
          partial: await unit.analyses.setStatus(runId, ['queued'], 'partial'),
          reopen: await unit.analyses.setStatus(runId, ['partial'], 'running'),
          snapshot: await unit.analyses.getBySnapshotId(snapshot.id),
        },
      }));
      expect(changed.data).toEqual({
        bound: true,
        replay: false,
        terminalExpected: false,
        partial: true,
        reopen: false,
        snapshot: {
          ...run,
          input,
          retrievalSnapshot: retrieval,
          status: 'partial',
        },
      });
    } finally {
      await database.close();
    }
  });

  it('should persist repeated model output against one snapshot with run-owned references and immutable prior output', async () => {
    const database = await createIsolatedDatabase();
    const transaction = createTransactionPort(database.db);
    const models = createDevelopmentModels();
    const ownerId = database.ownerId;

    try {
      const recordFields: RecordFields = {
        name: null,
        unitKind: 'single',
        components: [],
        pieceCount: null,
        categoryIds: [],
        materialIds: [],
        period: null,
        dimensions: {},
        location: { locationId: null, detail: '' },
        acquisition: { receiptAssetIds: [] },
        tags: [],
        description: 'Frozen collector description',
        collectorJudgment: null,
      };
      const recordId = randomUUID();
      const observed: Observation = {
        id: randomUUID(),
        recordId,
        componentIds: [],
        channel: 'typed',
        text: '表面手感粗糙',
        evidenceAnchorIds: [],
        checkIds: [],
        observedAt: now,
        voice: null,
        editDraftId: null,
        supersedesObservationId: null,
        author: 'collector',
        createdAt: now,
        supersededByObservationId: null,
      };
      const firstRunId = randomUUID();
      const secondRunId = randomUUID();
      const snapshot: RequestedAnalysisSnapshot = {
        id: randomUUID(),
        recordId,
        recordRevision: 2,
        analysisInputVersion: 2,
        evidenceVersion: 2,
        assetIds: [],
        evidenceIds: [],
        observationIds: [observed.id],
        checkIds: [],
        frozenPack: {
          recordFields,
          media: [],
          evidence: [],
          observations: [observed],
          checks: [],
        },
        createdAt: now,
      };
      await transaction.run(ownerId, async (unit) => {
        const record: RecordDetail = {
          ...recordFields,
          id: recordId,
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
        await unit.evidence.addObservation(observed);
        expect(
          await unit.records.bumpVersions(recordId, 1, {
            analysisInput: true,
            evidence: true,
          }),
        ).toEqual({
          recordRevision: 2,
          analysisInputVersion: 2,
          evidenceVersion: 2,
        });
        for (const runId of [firstRunId, secondRunId]) {
          const jobId = randomUUID();
          await unit.jobs.create({
            id: jobId,
            kind: 'analysis',
            resourceId: runId,
            state: { kind: 'queued' },
            createdAt: now,
            updatedAt: now,
            result: null,
          });
          const run: AnalysisRunRecord = {
            id: runId,
            jobId,
            recordId,
            requestedSnapshot: snapshot,
            modelSelection: selection,
            input: null,
            retrievalSnapshot: null,
            output: null,
            invocation: null,
            failureAudits: [],
            suggestedMethodVersions: [],
            status: 'queued',
          };
          await unit.analyses.create(run);
        }

        return { success: true as const, data: undefined };
      });
      const pack: AnalysisEvidencePack = {
        input: {
          recordId: snapshot.recordId,
          snapshotId: snapshot.id,
          recordRevision: snapshot.recordRevision,
          analysisInputVersion: snapshot.analysisInputVersion,
          evidenceVersion: snapshot.evidenceVersion,
          assetIds: [...snapshot.assetIds],
          evidenceIds: [...snapshot.evidenceIds],
          observationIds: [...snapshot.observationIds],
          checkIds: [...snapshot.checkIds],
          retrievalSnapshotId: randomUUID(),
          promptVersion: 'analysis-prompt-v1',
          schemaVersion: 'analysis-output-v1',
        },
        recordFields: snapshot.frozenPack.recordFields,
        text: snapshot.frozenPack.observations.map((item) => ({
          id: item.id,
          kind: 'observation' as const,
          content: item.text,
        })),
        images: [],
        citations: [],
        methods: [],
      };
      const modeled = await models.analysis.analyze(pack, selection);
      if (!modeled.success) {
        throw new Error('Development model fixture failed');
      }
      expect(modeled.data.value).toMatchObject({
        findings: [expect.objectContaining({ observationIds: [observed.id] })],
        nextActions: [expect.objectContaining({ kind: 'describe' })],
        proposedChanges: [
          expect.objectContaining({
            findingIds: [modeled.data.value.findings[0]?.id],
          }),
        ],
      });

      await transaction.run(ownerId, async (unit) => {
        await unit.analyses.saveOutput(
          firstRunId,
          modeled.data.value,
          [],
          modeled.data.invocation,
          'completed',
        );

        return { success: true as const, data: undefined };
      });
      const firstSaved = await transaction.run(ownerId, async (unit) => ({
        success: true as const,
        data: await unit.analyses.get(firstRunId),
      }));
      await transaction.run(ownerId, async (unit) => {
        await unit.analyses.saveOutput(
          secondRunId,
          modeled.data.value,
          [],
          modeled.data.invocation,
          'completed',
        );

        return { success: true as const, data: undefined };
      });
      const secondSaved = await transaction.run(ownerId, async (unit) => ({
        success: true as const,
        data: await unit.analyses.get(secondRunId),
      }));
      const firstOutput = firstSaved.data?.output;
      const secondOutput = secondSaved.data?.output;
      if (!firstOutput || !secondOutput) {
        throw new Error('Persisted output missing');
      }
      expectIndependentOutputs(firstOutput, secondOutput);

      const firstAgain = await transaction.run(ownerId, async (unit) => ({
        success: true as const,
        data: await unit.analyses.get(firstRunId),
      }));
      expect(firstAgain.data?.output).toEqual(firstOutput);
      const [
        savedClaims,
        savedActions,
        savedProposals,
        savedLinks,
        savedObservations,
        savedActionStates,
        savedProposalStates,
      ] = await Promise.all([
        database.db.claims.findMany({ where: { runId: secondRunId } }),
        database.db.nextActions.findMany({ where: { runId: secondRunId } }),
        database.db.proposals.findMany({ where: { runId: secondRunId } }),
        database.db.proposalFindings.findMany({
          where: { proposalId: secondOutput.proposedChanges[0]!.id },
        }),
        database.db.claimObservations.findMany({
          where: { claimId: secondOutput.findings[0]!.id },
        }),
        database.db.actionStates.findMany({ where: { runId: secondRunId } }),
        database.db.proposalStates.findMany({ where: { runId: secondRunId } }),
      ]);
      expect(savedClaims.map(({ id }) => id)).toEqual([
        secondOutput.findings[0]?.id,
      ]);
      expect(savedActions.map(({ id }) => id)).toEqual([
        secondOutput.nextActions[0]?.id,
      ]);
      expect(savedProposals.map(({ id }) => id)).toEqual([
        secondOutput.proposedChanges[0]?.id,
      ]);
      expect(savedLinks).toEqual([
        {
          proposalId: secondOutput.proposedChanges[0]?.id,
          claimId: secondOutput.findings[0]?.id,
        },
      ]);
      expect(savedObservations).toEqual([
        { claimId: secondOutput.findings[0]?.id, observationId: observed.id },
      ]);
      expect(
        savedActionStates.map(({ actionId, status }) => ({ actionId, status })),
      ).toEqual([
        { actionId: secondOutput.nextActions[0]?.id, status: 'pending' },
      ]);
      expect(
        savedProposalStates.map(({ proposalId, status }) => ({
          proposalId,
          status,
        })),
      ).toEqual([
        { proposalId: secondOutput.proposedChanges[0]?.id, status: 'pending' },
      ]);
    } finally {
      await database.close();
    }
  });

  it('should retain each failed model attempt separately across reconnect and later successful output', async () => {
    const isolated = await createIsolatedDatabase();
    let database = createDatabase({ url: isolated.url, maxConnections: 4 });
    const ownerId = isolated.ownerId;

    try {
      const transaction = createTransactionPort(database.db);
      const runId = await createQueuedRun(transaction, ownerId);
      const initial = await transaction.run(ownerId, async (unit) => ({
        success: true as const,
        data: await unit.analyses.get(runId),
      }));
      expect(initial.data?.failureAudits).toEqual([]);

      const malformedString: ModelFailureAudit = {
        invocation: null,
        rawOutput: '{"summary":',
      };
      const draftObject: ModelFailureAudit = {
        invocation: failureInvocation,
        rawOutput: { summary: 'unverified', findings: [{ text: 'draft' }] },
      };
      const nullOutput: ModelFailureAudit = {
        invocation: { ...failureInvocation, latencyMs: 4 },
        rawOutput: null,
      };
      const append = async (audit: ModelFailureAudit): Promise<boolean> => {
        const result = await transaction.run(ownerId, async (unit) => ({
          success: true as const,
          data: await unit.analyses.appendFailureAudit(runId, audit),
        }));

        return result.data;
      };
      expect(await append(malformedString)).toBe(true);
      const running = await transaction.run(ownerId, async (unit) => ({
        success: true as const,
        data: await unit.analyses.setStatus(runId, ['queued'], 'running'),
      }));
      expect(running.data).toBe(true);
      expect(
        await Promise.all([append(draftObject), append(draftObject)]),
      ).toEqual([true, true]);
      expect(await append(nullOutput)).toBe(true);

      await database.close();
      database = createDatabase({ url: isolated.url, maxConnections: 1 });
      const reopened = createTransactionPort(database.db);
      const beforeSuccess = await reopened.run(ownerId, async (unit) => ({
        success: true as const,
        data: await unit.analyses.get(runId),
      }));
      expect(beforeSuccess.data?.failureAudits).toEqual([
        malformedString,
        draftObject,
        draftObject,
        nullOutput,
      ]);
      expect(beforeSuccess.data).toMatchObject({
        status: 'running',
        output: null,
        invocation: nullOutput.invocation,
      });
      const [storedBeforeSuccess] = await database.db.analysisRuns.findMany({
        select: { rawOutput: true, completedAt: true },
        where: { id: runId },
      });
      expect(storedBeforeSuccess).toEqual({
        rawOutput: null,
        completedAt: null,
      });

      const validOutput: AnalysisOutput = {
        summary: 'Validated response',
        findings: [],
        uncertainties: [],
        suggestedMethodIds: [],
        nextActions: [],
        proposedChanges: [],
      };
      await reopened.run(ownerId, async (unit) => {
        await unit.analyses.saveOutput(
          runId,
          validOutput,
          [],
          failureInvocation,
          'completed',
        );

        return { success: true as const, data: undefined };
      });
      const afterSuccess = await reopened.run(ownerId, async (unit) => ({
        success: true as const,
        data: await unit.analyses.get(runId),
      }));
      expect(afterSuccess.data?.output).toEqual(validOutput);
      expect(afterSuccess.data?.failureAudits).toEqual(
        beforeSuccess.data?.failureAudits,
      );
      expect(afterSuccess.data?.status).toBe('completed');
      const terminalAppend = await reopened.run(ownerId, async (unit) => ({
        success: true as const,
        data: await unit.analyses.appendFailureAudit(runId, draftObject),
      }));
      expect(terminalAppend.data).toBe(false);
    } finally {
      await database.close();
      await isolated.close();
    }
  });

  it('should deny foreign-owner and failed-terminal audit access', async () => {
    const database = await createIsolatedDatabase();
    const transaction = createTransactionPort(database.db);
    const ownerId = database.ownerId;
    const foreignOwnerId = randomUUID();
    const audit: ModelFailureAudit = {
      invocation: failureInvocation,
      rawOutput: 'private failed response',
    };

    try {
      const runId = await createQueuedRun(transaction, ownerId);
      const foreign = await transaction.run(foreignOwnerId, async (unit) => ({
        success: true as const,
        data: {
          run: await unit.analyses.get(runId),
          appended: await unit.analyses.appendFailureAudit(runId, audit),
        },
      }));
      expect(foreign.data).toEqual({ run: null, appended: false });
      const failed = await transaction.run(ownerId, async (unit) => ({
        success: true as const,
        data: await unit.analyses.setStatus(runId, ['queued'], 'failed'),
      }));
      expect(failed.data).toBe(true);
      const terminal = await transaction.run(ownerId, async (unit) => ({
        success: true as const,
        data: {
          appended: await unit.analyses.appendFailureAudit(runId, audit),
          run: await unit.analyses.get(runId),
        },
      }));
      expect(terminal.data.appended).toBe(false);
      expect(terminal.data.run).toMatchObject({
        status: 'failed',
        output: null,
        failureAudits: [],
      });
    } finally {
      await database.close();
    }
  });
});

async function createQueuedRun(
  transaction: ReturnType<typeof createTransactionPort>,
  ownerId: string,
): Promise<string> {
  const recordId = randomUUID();
  const runId = randomUUID();
  const recordFields: RecordFields = {
    name: null,
    unitKind: 'single',
    components: [],
    pieceCount: null,
    categoryIds: [],
    materialIds: [],
    period: null,
    dimensions: {},
    location: { locationId: null, detail: '' },
    acquisition: { receiptAssetIds: [] },
    tags: [],
    description: 'Frozen collector description',
    collectorJudgment: null,
  };
  const snapshot: RequestedAnalysisSnapshot = {
    id: randomUUID(),
    recordId,
    recordRevision: 1,
    analysisInputVersion: 1,
    evidenceVersion: 1,
    assetIds: [],
    evidenceIds: [],
    observationIds: [],
    checkIds: [],
    frozenPack: {
      recordFields,
      media: [],
      evidence: [],
      observations: [],
      checks: [],
    },
    createdAt: now,
  };
  await transaction.run(ownerId, async (unit) => {
    const record: RecordDetail = {
      ...recordFields,
      id: recordId,
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
    const jobId = randomUUID();
    await unit.jobs.create({
      id: jobId,
      kind: 'analysis',
      resourceId: runId,
      state: { kind: 'queued' },
      createdAt: now,
      updatedAt: now,
      result: null,
    });
    await unit.analyses.create({
      id: runId,
      jobId,
      recordId,
      requestedSnapshot: snapshot,
      modelSelection: selection,
      input: null,
      retrievalSnapshot: null,
      output: null,
      invocation: null,
      failureAudits: [],
      suggestedMethodVersions: [],
      status: 'queued',
    });

    return { success: true as const, data: undefined };
  });

  return runId;
}

function expectIndependentOutputs(
  firstOutput: AnalysisOutput,
  secondOutput: AnalysisOutput,
): void {
  expect(firstOutput.findings).toHaveLength(1);
  expect(firstOutput.nextActions).toHaveLength(1);
  expect(firstOutput.proposedChanges).toHaveLength(1);
  expect(secondOutput.findings).toHaveLength(1);
  expect(secondOutput.nextActions).toHaveLength(1);
  expect(secondOutput.proposedChanges).toHaveLength(1);
  expect(secondOutput.proposedChanges[0]?.findingIds).toEqual([
    secondOutput.findings[0]?.id,
  ]);
  expect(firstOutput.proposedChanges[0]?.findingIds).toEqual([
    firstOutput.findings[0]?.id,
  ]);
  expect([
    secondOutput.findings[0]?.id === firstOutput.findings[0]?.id,
    secondOutput.nextActions[0]?.id === firstOutput.nextActions[0]?.id,
    secondOutput.proposedChanges[0]?.id === firstOutput.proposedChanges[0]?.id,
  ]).toEqual([false, false, false]);
}

async function queueFollowupRun(
  transaction: ReturnType<typeof createTransactionPort>,
  ownerId: string,
  prior: AnalysisRunRecord,
): Promise<AnalysisRunRecord> {
  const run: AnalysisRunRecord = {
    ...prior,
    id: randomUUID(),
    jobId: randomUUID(),
    input: null,
    retrievalSnapshot: null,
    output: null,
    invocation: null,
    failureAudits: [],
    suggestedMethodVersions: [],
    status: 'queued',
  };
  await transaction.run(ownerId, async (unit) => {
    await unit.jobs.create({
      id: run.jobId,
      kind: 'analysis',
      resourceId: run.id,
      state: { kind: 'queued' },
      createdAt: now,
      updatedAt: now,
      result: null,
    });
    await unit.analyses.create(run);

    return { success: true as const, data: undefined };
  });

  return run;
}
