import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';

import postgres from 'postgres';
import { describe, expect, it } from 'vitest';

import { generateDrizzleJson, generateMigration } from 'drizzle-kit/api';

import {
  analysisSnapshots,
  snapshotAssets,
  snapshotEvidence,
  snapshotObservations,
  snapshotChecks,
  retrievalSnapshots,
  analysisRuns,
  runSuggestedMethods,
  claims,
  claimEvidence,
  claimObservations,
  claimCitations,
  nextActions,
  actionStates,
  actionResolutions,
  resolutionEvidence,
  resolutionObservations,
  resolutionReferences,
  resolutionChecks,
  proposals,
  proposalFindings,
  proposalStates,
  adoptionEvents,
  user,
  session,
  account,
  verification,
  otpSendCooldown,
  evidenceAnchors,
  anchorComponents,
  observations,
  observationComponents,
  observationAnchors,
  recordChecks,
  checkComponents,
  checkObservations,
  checkAnchors,
  sources,
  sourceContributors,
  sourceLanguages,
  sourceVersions,
  sourceArtifacts,
  sourceVersionAssets,
  sourcePages,
  parseRuns,
  sourcePageParses,
  sourceBlocks,
  sourceRegions,
  regionRelations,
  sourceLocators,
  citations,
  referenceImages,
  knowledgeEntries,
  sourceKnowledgeDrafts,
  knowledgeRevisions,
  knowledgeRevisionAliases,
  knowledgeRevisionKinds,
  knowledgeRevisionCitations,
  inspectionMethods,
  methodVersions,
  knowledgeRevisionMethods,
  researchRuns,
  researchSources,
  researchDraftRevisions,
  notes,
  noteParagraphs,
  noteCitations,
  referenceLinks,
  indexVersions,
  sourceIndexMemberships,
  sourceChunkMappings,
  mappingRegions,
  imageIndexItems,
  sourceIntakes,
  mediaAssets,
  mediaAssetComponents,
  uploadSessions,
  uploadParts,
  mediaDerivatives,
  canonicalViews,
  locations,
  records,
  recordComponents,
  recordCategories,
  recordMaterials,
  recordTags,
  recordMeasurements,
  recordAcquisitions,
  recordReceipts,
  jobs,
  jobSteps,
  outbox,
  idempotencyRequests,
  providerJobMappings,
  providerEvents,
  providerWebhookInbox,
  providerCompletions,
  sequenceCounters,
  transcriptionRuns,
  editDraftRuns,
  comparisonResults,
  comparisonFailures,
} from './index.js';

import type { DrizzleSnapshotJSON } from 'drizzle-kit/api';

const schema = {
  analysisSnapshots,
  snapshotAssets,
  snapshotEvidence,
  snapshotObservations,
  snapshotChecks,
  retrievalSnapshots,
  analysisRuns,
  runSuggestedMethods,
  claims,
  claimEvidence,
  claimObservations,
  claimCitations,
  nextActions,
  actionStates,
  actionResolutions,
  resolutionEvidence,
  resolutionObservations,
  resolutionReferences,
  resolutionChecks,
  proposals,
  proposalFindings,
  proposalStates,
  adoptionEvents,
  user,
  session,
  account,
  verification,
  otpSendCooldown,
  evidenceAnchors,
  anchorComponents,
  observations,
  observationComponents,
  observationAnchors,
  recordChecks,
  checkComponents,
  checkObservations,
  checkAnchors,
  sources,
  sourceContributors,
  sourceLanguages,
  sourceVersions,
  sourceArtifacts,
  sourceVersionAssets,
  sourcePages,
  parseRuns,
  sourcePageParses,
  sourceBlocks,
  sourceRegions,
  regionRelations,
  sourceLocators,
  citations,
  referenceImages,
  knowledgeEntries,
  sourceKnowledgeDrafts,
  knowledgeRevisions,
  knowledgeRevisionAliases,
  knowledgeRevisionKinds,
  knowledgeRevisionCitations,
  inspectionMethods,
  methodVersions,
  knowledgeRevisionMethods,
  researchRuns,
  researchSources,
  researchDraftRevisions,
  notes,
  noteParagraphs,
  noteCitations,
  referenceLinks,
  indexVersions,
  sourceIndexMemberships,
  sourceChunkMappings,
  mappingRegions,
  imageIndexItems,
  sourceIntakes,
  mediaAssets,
  mediaAssetComponents,
  uploadSessions,
  uploadParts,
  mediaDerivatives,
  canonicalViews,
  locations,
  records,
  recordComponents,
  recordCategories,
  recordMaterials,
  recordTags,
  recordMeasurements,
  recordAcquisitions,
  recordReceipts,
  jobs,
  jobSteps,
  outbox,
  idempotencyRequests,
  providerJobMappings,
  providerEvents,
  providerWebhookInbox,
  providerCompletions,
  sequenceCounters,
  transcriptionRuns,
  editDraftRuns,
  comparisonResults,
  comparisonFailures,
};

describe('generated database migration behavior', () => {
  it('should produce executable DDL that enforces constraints and cascading account ownership', async () => {
    const baseUrl = process.env.ANTICA_TEST_DATABASE_URL;
    if (!baseUrl) {
      throw new Error('ANTICA_TEST_DATABASE_URL is required');
    }
    const name = `antica_generated_${randomUUID().replaceAll('-', '')}`;
    const admin = postgres(baseUrl, { max: 1, prepare: false });
    await admin`create database ${admin(name)}`;
    const target = new URL(baseUrl);
    target.pathname = `/${name}`;
    const database = postgres(target.toString(), { max: 1, prepare: false });
    try {
      const empty = generateDrizzleJson({});
      const current = generateDrizzleJson(schema, empty.id);
      const accepted = JSON.parse(
        await readFile(
          new URL('../migrations/meta/0008_snapshot.json', import.meta.url),
          'utf8',
        ),
      ) as DrizzleSnapshotJSON;
      expect(await generateMigration(accepted, current)).toEqual([]);
      const statements = await generateMigration(empty, current);
      for (const statement of statements) {
        await database.unsafe(statement);
      }
      const ownerId = randomUUID();
      const recordId = randomUUID();
      await database`insert into records (id, owner_id, code, unit_kind, piece_count) values (${recordId}, ${ownerId}, 'R-1', 'set', 2)`;
      expect(
        await database`select piece_count from records where id = ${recordId}`,
      ).toEqual([{ piece_count: 2 }]);
      await expect(
        database`insert into records (id, owner_id, code, unit_kind, piece_count) values (${randomUUID()}, ${ownerId}, 'R-2', 'set', 0)`,
      ).rejects.toMatchObject({ code: '23514' });
      await expect(
        database`insert into records (id, owner_id, code, unit_kind) values (${randomUUID()}, ${ownerId}, 'R-1', 'single')`,
      ).rejects.toMatchObject({ code: '23505' });
      const userId = randomUUID();
      const email = userId + '@example.invalid';
      await database`insert into "user" (id, name, email) values (${userId}, 'Collector', ${email})`;
      await database`insert into session (id, token, user_id, expires_at) values (${randomUUID()}, ${randomUUID()}, ${userId}, '2030-01-01')`;
      await database`delete from "user" where id = ${userId}`;
      expect(
        await database`select id from session where user_id = ${userId}`,
      ).toEqual([]);
      expect(
        await generateMigration(
          current,
          generateDrizzleJson(schema, current.id),
        ),
      ).toEqual([]);
    } finally {
      await database.end();
      await admin`drop database ${admin(name)}`;
      await admin.end();
    }
  });
  it('should upgrade populated owner indexes without replacing their identities or dependent foreign keys', async () => {
    const baseUrl = process.env.ANTICA_TEST_DATABASE_URL;
    if (!baseUrl) {
      throw new Error('ANTICA_TEST_DATABASE_URL is required');
    }
    const name = `antica_upgrade_${randomUUID().replaceAll('-', '')}`;
    const admin = postgres(baseUrl, { max: 1, prepare: false });
    await admin`create database ${admin(name)}`;
    const target = new URL(baseUrl);
    target.pathname = `/${name}`;
    const database = postgres(target.toString(), { max: 1, prepare: false });
    const migrationRoot = new URL('../migrations/', import.meta.url);
    try {
      const files = (await readdir(migrationRoot))
        .filter((file) => /^000[0-6]_.*\.sql$/.test(file))
        .sort();
      for (const file of files) {
        const migration = await readFile(new URL(file, migrationRoot), 'utf8');
        for (const statement of migration.split('--> statement-breakpoint')) {
          await database.unsafe(statement);
        }
      }
      const ownerId = randomUUID();
      const sourceId = randomUUID();
      const versionId = randomUUID();
      const entryId = randomUUID();
      const foreignEntryId = randomUUID();
      await database`insert into sources (id, owner_id, kind, title, author_status, access) values (${sourceId}, ${ownerId}, 'web', 'Catalog', 'unknown', 'link_only')`;
      await database`insert into source_versions (id, source_id, owner_id, source_hash, metadata_snapshot, captured_at, status, text_index_status, image_index_status) values (${versionId}, ${sourceId}, ${ownerId}, ${'a'.repeat(64)}, '{}', now(), 'registered', 'registered', 'registered')`;
      await database`insert into knowledge_entries (id, owner_id, display_code, current_revision) values (${entryId}, ${ownerId}, 'KN-1', 1), (${foreignEntryId}, ${randomUUID()}, 'KN-2', 1)`;
      await database`insert into source_knowledge_drafts (owner_id, source_version_id, entry_id) values (${ownerId}, ${versionId}, ${entryId})`;
      const indexesBefore =
        await database`select oid, relname from pg_class where relname in ('knowledge_entries_owner_id_uq', 'source_versions_owner_id_uq') order by relname`;
      const foreignKeysBefore =
        await database`select oid, conname, pg_get_constraintdef(oid) as definition from pg_constraint where contype = 'f' and confrelid in ('knowledge_entries'::regclass, 'source_versions'::regclass) order by oid`;
      await expect(
        database`insert into source_knowledge_drafts (owner_id, source_version_id, entry_id) values (${ownerId}, ${versionId}, ${foreignEntryId})`,
      ).rejects.toMatchObject({ code: '23503' });
      const upgrade = await readFile(
        new URL('0007_owner_identity_constraints.sql', migrationRoot),
        'utf8',
      );
      for (const statement of upgrade.split('--> statement-breakpoint')) {
        await database.unsafe(statement);
      }

      expect(
        await database`select conname from pg_constraint where contype = 'u' and conname in ('knowledge_entries_owner_id_uq', 'source_versions_owner_id_uq') order by conname`,
      ).toEqual([
        { conname: 'knowledge_entries_owner_id_uq' },
        { conname: 'source_versions_owner_id_uq' },
      ]);
      expect(
        await database`select oid, relname from pg_class where relname in ('knowledge_entries_owner_id_uq', 'source_versions_owner_id_uq') order by relname`,
      ).toEqual(indexesBefore);
      expect(
        await database`select oid, conname, pg_get_constraintdef(oid) as definition from pg_constraint where contype = 'f' and confrelid in ('knowledge_entries'::regclass, 'source_versions'::regclass) order by oid`,
      ).toEqual(foreignKeysBefore);
      expect(
        await database`select owner_id, source_version_id, entry_id from source_knowledge_drafts`,
      ).toEqual([
        { owner_id: ownerId, source_version_id: versionId, entry_id: entryId },
      ]);
      expect(
        await database`select id from source_versions where id = ${versionId}`,
      ).toEqual([{ id: versionId }]);
      expect(
        await database`select id from knowledge_entries order by id`,
      ).toEqual([entryId, foreignEntryId].sort().map((id) => ({ id })));
      await expect(
        database`insert into source_knowledge_drafts (owner_id, source_version_id, entry_id) values (${ownerId}, ${versionId}, ${foreignEntryId})`,
      ).rejects.toMatchObject({ code: '23503' });
    } finally {
      await database.end();
      await admin`drop database ${admin(name)}`;
      await admin.end();
    }
  });
  it('should backfill only missing latest analysis pointers and preserve immutable history on replay', async () => {
    const baseUrl = process.env.ANTICA_TEST_DATABASE_URL;
    if (!baseUrl) {
      throw new Error('ANTICA_TEST_DATABASE_URL is required');
    }
    const name = `antica_backfill_${randomUUID().replaceAll('-', '')}`;
    const admin = postgres(baseUrl, { max: 1, prepare: false });
    await admin`create database ${admin(name)}`;
    const target = new URL(baseUrl);
    target.pathname = `/${name}`;
    const database = postgres(target.toString(), { max: 1, prepare: false });
    const migrationRoot = new URL('../migrations/', import.meta.url);
    try {
      const files = (await readdir(migrationRoot))
        .filter((file) => /^000[0-7]_.*\.sql$/.test(file))
        .sort();
      for (const file of files) {
        const migration = await readFile(new URL(file, migrationRoot), 'utf8');
        for (const statement of migration.split('--> statement-breakpoint')) {
          await database.unsafe(statement);
        }
      }
      const ownerId = randomUUID();
      const otherOwnerId = randomUUID();
      const tiedRecordId = randomUUID();
      const temporalRecordId = randomUUID();
      const pinnedRecordId = randomUUID();
      const ineligibleRecordId = randomUUID();
      const emptyRecordId = randomUUID();
      const recordIds = [
        tiedRecordId,
        temporalRecordId,
        pinnedRecordId,
        ineligibleRecordId,
        emptyRecordId,
      ];
      const tiedRunIds = [randomUUID(), randomUUID()].sort();
      const olderRunId = randomUUID();
      const newerRunId = randomUUID();
      const pinnedRunId = randomUUID();
      for (const id of recordIds) {
        await database`insert into records (id, owner_id, code, unit_kind, record_revision, analysis_input_version, evidence_version, updated_at) values (${id}, ${ownerId}, ${id}, 'single', 7, 5, 3, '2026-10-10T00:00:00Z')`;
      }
      const usableOutput = {
        summaryZhHant: '歷史分析',
        findings: [],
        proposals: [],
        citations: [],
      };
      const runs = [
        {
          id: tiedRunIds[0]!,
          recordId: tiedRecordId,
          ownerId,
          status: 'completed',
          createdAt: '2026-10-11T00:00:00Z',
          output: usableOutput,
        },
        {
          id: tiedRunIds[1]!,
          recordId: tiedRecordId,
          ownerId,
          status: 'partial',
          createdAt: '2026-10-11T00:00:00Z',
          output: usableOutput,
        },
        {
          id: randomUUID(),
          recordId: tiedRecordId,
          ownerId,
          status: 'failed',
          createdAt: '2026-10-13T00:00:00Z',
          output: usableOutput,
        },
        {
          id: olderRunId,
          recordId: temporalRecordId,
          ownerId,
          status: 'partial',
          createdAt: '2026-10-10T00:00:00Z',
          output: usableOutput,
        },
        {
          id: newerRunId,
          recordId: temporalRecordId,
          ownerId,
          status: 'completed',
          createdAt: '2026-10-12T00:00:00Z',
          output: usableOutput,
        },
        {
          id: pinnedRunId,
          recordId: pinnedRecordId,
          ownerId,
          status: 'completed',
          createdAt: '2026-10-10T00:00:00Z',
          output: usableOutput,
        },
        {
          id: randomUUID(),
          recordId: pinnedRecordId,
          ownerId,
          status: 'completed',
          createdAt: '2026-10-13T00:00:00Z',
          output: usableOutput,
        },
        {
          id: randomUUID(),
          recordId: ineligibleRecordId,
          ownerId,
          status: 'pending',
          createdAt: '2026-10-13T00:00:00Z',
          output: usableOutput,
        },
        {
          id: randomUUID(),
          recordId: ineligibleRecordId,
          ownerId,
          status: 'failed',
          createdAt: '2026-10-13T00:00:00Z',
          output: usableOutput,
        },
        {
          id: randomUUID(),
          recordId: ineligibleRecordId,
          ownerId,
          status: 'completed',
          createdAt: '2026-10-13T00:00:00Z',
          output: null,
        },
        {
          id: randomUUID(),
          recordId: ineligibleRecordId,
          ownerId,
          status: 'partial',
          createdAt: '2026-10-13T00:00:00Z',
          output: null,
        },
        {
          id: randomUUID(),
          recordId: ineligibleRecordId,
          ownerId: otherOwnerId,
          status: 'completed',
          createdAt: '2026-10-13T00:00:00Z',
          output: usableOutput,
        },
      ];
      for (const run of runs) {
        const jobId = randomUUID();
        const snapshotId = randomUUID();
        await database`insert into jobs (id, owner_id, kind, resource_id, state, stage) values (${jobId}, ${run.ownerId}, 'analysis', ${run.recordId}, 'done', 'complete')`;
        await database`insert into analysis_snapshots (id, owner_id, record_id, record_revision, analysis_input_version, evidence_version, content, content_hash) values (${snapshotId}, ${run.ownerId}, ${run.recordId}, 6, 4, 2, '{}', ${run.id})`;
        await database`insert into analysis_runs (id, owner_id, record_id, job_id, snapshot_id, status, model_selection, profile_version, prompt_version, schema_version, raw_output, created_at) values (${run.id}, ${run.ownerId}, ${run.recordId}, ${jobId}, ${snapshotId}, ${run.status}, '{}', '1', '1', '1', ${run.output === null ? null : database.json(run.output)}, ${run.createdAt})`;
      }
      await database`update records set latest_run_id = ${pinnedRunId} where id = ${pinnedRecordId}`;
      const proposalId = randomUUID();
      await database`insert into proposals (id, run_id, field, before, proposed) values (${proposalId}, ${pinnedRunId}, 'description', '{}', '{"text":"preserved"}')`;
      await database`insert into adoption_events (id, run_id, proposal_id, status, record_revision) values (${randomUUID()}, ${pinnedRunId}, ${proposalId}, 'accepted', 7)`;
      const eventsBefore =
        await database`select * from adoption_events order by id`;
      const proposalsBefore =
        await database`select * from proposals order by id`;
      const recordsBefore =
        await database`select to_jsonb(records) - 'latest_run_id' as data from records order by id`;
      const runsBefore =
        await database`select * from analysis_runs order by id`;
      const snapshotsBefore =
        await database`select * from analysis_snapshots order by id`;
      const jobsBefore = await database`select * from jobs order by id`;
      const upgradeFiles = (await readdir(migrationRoot)).filter((file) =>
        /^0008_.*\.sql$/.test(file),
      );
      if (upgradeFiles.length !== 1) {
        throw new Error('Exactly one 0008 migration is required');
      }
      const upgrade = await readFile(
        new URL(upgradeFiles[0]!, migrationRoot),
        'utf8',
      );
      for (const statement of upgrade.split('--> statement-breakpoint')) {
        await database.unsafe(statement);
      }

      expect(
        await database`select id, latest_run_id from records order by id`,
      ).toEqual(
        [
          { id: tiedRecordId, latest_run_id: tiedRunIds[1] },
          { id: temporalRecordId, latest_run_id: newerRunId },
          { id: pinnedRecordId, latest_run_id: pinnedRunId },
          { id: ineligibleRecordId, latest_run_id: null },
          { id: emptyRecordId, latest_run_id: null },
        ].sort((left, right) => left.id.localeCompare(right.id)),
      );
      expect(
        await database`select to_jsonb(records) - 'latest_run_id' as data from records order by id`,
      ).toEqual(recordsBefore);
      expect(await database`select * from analysis_runs order by id`).toEqual(
        runsBefore,
      );
      expect(
        await database`select * from analysis_snapshots order by id`,
      ).toEqual(snapshotsBefore);
      expect(await database`select * from jobs order by id`).toEqual(
        jobsBefore,
      );
      expect(await database`select * from adoption_events order by id`).toEqual(
        eventsBefore,
      );
      expect(await database`select * from proposals order by id`).toEqual(
        proposalsBefore,
      );
      const recordsAfter = await database`select * from records order by id`;
      for (const statement of upgrade.split('--> statement-breakpoint')) {
        await database.unsafe(statement);
      }
      expect(await database`select * from records order by id`).toEqual(
        recordsAfter,
      );
      expect(await database`select * from analysis_runs order by id`).toEqual(
        runsBefore,
      );
      expect(
        await database`select * from analysis_snapshots order by id`,
      ).toEqual(snapshotsBefore);
      expect(await database`select * from jobs order by id`).toEqual(
        jobsBefore,
      );
      expect(await database`select * from adoption_events order by id`).toEqual(
        eventsBefore,
      );
      expect(await database`select * from proposals order by id`).toEqual(
        proposalsBefore,
      );
    } finally {
      await database.end();
      await admin`drop database ${admin(name)}`;
      await admin.end();
    }
  });
});
