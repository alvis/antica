import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { describe, expect, inject } from 'vitest';

import { createDatabaseTest } from '../spec/fixtures/runner.js';

import {
  adoptionEvents,
  analysisRuns,
  analysisSnapshots,
  proposals,
} from './analysis.js';
import { account, session, user } from './auth.js';
import { evidenceAnchors, mediaAssets, records } from './index.js';
import {
  knowledgeEntries,
  sourceKnowledgeDrafts,
  sources,
  sourceVersions,
} from './knowledge.js';
import { canonicalViews } from './media.js';
import { jobs, outbox } from './runtime.js';
import { editDraftRuns } from './workflows.js';

const url = process.env.ANTICA_TEST_DATABASE_URL;
if (!url) {
  throw new Error(
    'ANTICA_TEST_DATABASE_URL must identify an isolated PostgreSQL database',
  );
}

const resources = inject('platformDatabases');
const it = createDatabaseTest(resources.constraints!);

describe('persisted record constraints', () => {
  it('should accept a positive piece count and reject zero', async ({
    connection,
  }) => {
    const ownerId = randomUUID();
    await expect(
      connection.db.transaction(async (tx) => {
        const id = randomUUID();
        await tx
          .insert(records)
          .values({ id, ownerId, code: 'R-1', unitKind: 'set', pieceCount: 2 });
        expect(
          await tx
            .select({ pieceCount: records.pieceCount })
            .from(records)
            .where(eq(records.id, id)),
        ).toEqual([{ pieceCount: 2 }]);
        await tx.insert(records).values({
          id: randomUUID(),
          ownerId,
          code: 'R-2',
          unitKind: 'set',
          pieceCount: 0,
        });
      }),
    ).rejects.toMatchObject({
      cause: { code: '23514', constraint_name: 'records_piece_count_ck' },
    });
  });

  it('should reject a period whose end precedes its start', async ({
    connection,
  }) => {
    await expect(
      connection.db.insert(records).values({
        id: randomUUID(),
        ownerId: randomUUID(),
        code: 'R-PERIOD',
        unitKind: 'single',
        periodFromYear: 1900,
        periodToYear: 1800,
      }),
    ).rejects.toMatchObject({
      cause: { code: '23514', constraint_name: 'records_period_year_ck' },
    });
  });
});

describe('persisted media and evidence constraints', () => {
  it('should require exactly one owning resource for an asset', async ({
    connection,
  }) => {
    const ownerId = randomUUID();
    await expect(
      connection.db.transaction(async (tx) => {
        const recordId = randomUUID();
        const assetId = randomUUID();
        await tx.insert(records).values({
          id: recordId,
          ownerId,
          code: 'R-MEDIA',
          unitKind: 'single',
        });
        await tx.insert(mediaAssets).values({
          id: assetId,
          ownerId,
          recordId,
          kind: 'image',
          purpose: 'record_original',
          state: 'ready',
          objectKey: randomUUID(),
          originalFileName: 'photo.jpg',
          mimeType: 'image/jpeg',
          byteLength: 5,
          sha256: 'a'.repeat(64),
        });
        expect(
          await tx
            .select({ recordId: mediaAssets.recordId })
            .from(mediaAssets)
            .where(eq(mediaAssets.id, assetId)),
        ).toEqual([{ recordId }]);
        await tx.insert(mediaAssets).values({
          id: randomUUID(),
          ownerId,
          kind: 'image',
          purpose: 'record_original',
          state: 'ready',
          objectKey: randomUUID(),
          originalFileName: 'orphan.jpg',
          mimeType: 'image/jpeg',
          byteLength: 5,
          sha256: 'b'.repeat(64),
        });
      }),
    ).rejects.toMatchObject({
      cause: { code: '23514', constraint_name: 'media_assets_owner_xor_ck' },
    });
  });

  it('should reject a region anchor without region geometry', async ({
    connection,
  }) => {
    const ownerId = randomUUID();
    await expect(
      connection.db.transaction(async (tx) => {
        const recordId = randomUUID();
        const assetId = randomUUID();
        const viewId = randomUUID();
        await tx.insert(records).values({
          id: recordId,
          ownerId,
          code: 'R-ANCHOR',
          unitKind: 'single',
        });
        await tx.insert(mediaAssets).values({
          id: assetId,
          ownerId,
          recordId,
          kind: 'image',
          purpose: 'record_original',
          state: 'ready',
          objectKey: randomUUID(),
          originalFileName: 'photo.jpg',
          mimeType: 'image/jpeg',
          byteLength: 5,
          sha256: 'c'.repeat(64),
        });
        await tx.insert(canonicalViews).values({
          id: viewId,
          originalAssetId: assetId,
          width: 100,
          height: 100,
          coordinateSpace: 'image_pixels',
          transformToOriginal: [1, 0, 0, 0, 1, 0, 0, 0, 1],
        });
        await tx.insert(evidenceAnchors).values({
          id: randomUUID(),
          ownerId,
          recordId,
          originalAssetId: assetId,
          canonicalViewId: viewId,
          kind: 'photo',
          scopeKind: 'whole',
        });
        await tx.insert(evidenceAnchors).values({
          id: randomUUID(),
          ownerId,
          recordId,
          originalAssetId: assetId,
          canonicalViewId: viewId,
          kind: 'photo',
          scopeKind: 'region',
        });
      }),
    ).rejects.toMatchObject({
      cause: { code: '23514', constraint_name: 'evidence_anchor_scope_ck' },
    });
  });
});

describe('persisted account and workflow behavior', () => {
  it('should remove sessions and accounts when their user is deleted', async ({
    connection,
  }) => {
    const id = randomUUID();
    const sessionId = randomUUID();
    const accountId = randomUUID();
    await connection.db
      .insert(user)
      .values({ id, name: 'Test collector', email: `${id}@example.invalid` });
    try {
      await connection.db.insert(session).values({
        id: sessionId,
        userId: id,
        token: randomUUID(),
        expiresAt: new Date('2030-01-01T00:00:00Z'),
      });
      await connection.db
        .insert(account)
        .values({ id: accountId, userId: id, accountId, providerId: 'test' });

      await connection.db.delete(user).where(eq(user.id, id));

      expect(
        await connection.db
          .select({ id: session.id })
          .from(session)
          .where(eq(session.id, sessionId)),
      ).toEqual([]);
      expect(
        await connection.db
          .select({ id: account.id })
          .from(account)
          .where(eq(account.id, accountId)),
      ).toEqual([]);
    } finally {
      await connection.db.delete(user).where(eq(user.id, id));
    }
  });

  it('should reject duplicate outbox events by name and idempotency key', async ({
    connection,
  }) => {
    const ownerId = randomUUID();
    const idempotencyKey = randomUUID();
    await expect(
      connection.db.transaction(async (tx) => {
        await tx.insert(outbox).values({
          eventId: randomUUID(),
          eventName: 'record.created',
          schemaVersion: '1',
          ownerId,
          resourceId: randomUUID(),
          idempotencyKey,
          payload: {},
        });
        await tx.insert(outbox).values({
          eventId: randomUUID(),
          eventName: 'record.created',
          schemaVersion: '1',
          ownerId,
          resourceId: randomUUID(),
          idempotencyKey,
          payload: {},
        });
      }),
    ).rejects.toMatchObject({
      cause: { code: '23505', constraint_name: 'outbox_idempotency_uq' },
    });
  });

  it('should reject unknown edit-draft states', async ({ connection }) => {
    const ownerId = randomUUID();
    await expect(
      connection.db.transaction(async (tx) => {
        const recordId = randomUUID();
        const jobId = randomUUID();
        const secondJobId = randomUUID();
        await tx.insert(records).values({
          id: recordId,
          ownerId,
          code: 'R-DRAFT',
          unitKind: 'single',
        });
        await tx.insert(jobs).values({
          id: jobId,
          ownerId,
          kind: 'edit_draft',
          resourceId: recordId,
          state: 'pending',
          stage: 'queued',
        });
        await tx.insert(jobs).values({
          id: secondJobId,
          ownerId,
          kind: 'edit_draft',
          resourceId: recordId,
          state: 'pending',
          stage: 'queued',
        });
        await tx.insert(editDraftRuns).values({
          id: randomUUID(),
          ownerId,
          jobId,
          recordId,
          revision: 1,
          status: 'pending',
          snapshot: {},
          request: {},
          modelSelection: {},
          createdAt: '2026-10-13T00:00:00Z',
          updatedAt: '2026-10-13T00:00:00Z',
        });
        await tx.insert(editDraftRuns).values({
          id: randomUUID(),
          ownerId,
          jobId: secondJobId,
          recordId,
          revision: 1,
          status: 'unknown',
          snapshot: {},
          request: {},
          modelSelection: {},
          createdAt: '2026-10-13T00:00:00Z',
          updatedAt: '2026-10-13T00:00:00Z',
        });
      }),
    ).rejects.toMatchObject({
      cause: { code: '23514', constraint_name: 'edit_draft_runs_status_ck' },
    });
  });
});

describe('persisted research ownership and analysis outcomes', () => {
  it('should reject attaching another owner’s knowledge entry to a source version', async ({
    connection,
  }) => {
    const ownerId = randomUUID();
    const otherOwnerId = randomUUID();
    await expect(
      connection.db.transaction(async (tx) => {
        const sourceId = randomUUID();
        const sourceVersionId = randomUUID();
        const ownEntryId = randomUUID();
        await tx.insert(sources).values({
          id: sourceId,
          ownerId,
          kind: 'web',
          title: 'Catalog',
          authorStatus: 'unknown',
          access: 'online',
        });
        await tx.insert(sourceVersions).values({
          id: sourceVersionId,
          sourceId,
          ownerId,
          sourceHash: randomUUID(),
          metadataSnapshot: {},
          capturedAt: '2026-10-13T00:00:00Z',
          status: 'registered',
          textIndexStatus: 'registered',
          imageIndexStatus: 'registered',
        });
        await tx.insert(knowledgeEntries).values({
          id: ownEntryId,
          ownerId,
          displayCode: 'K-1',
          currentRevision: 1,
        });
        await tx
          .insert(sourceKnowledgeDrafts)
          .values({ ownerId, sourceVersionId, entryId: ownEntryId });
        const foreignEntryId = randomUUID();
        await tx.insert(knowledgeEntries).values({
          id: foreignEntryId,
          ownerId: otherOwnerId,
          displayCode: 'K-1',
          currentRevision: 1,
        });
        await tx
          .insert(sourceKnowledgeDrafts)
          .values({ ownerId, sourceVersionId, entryId: foreignEntryId });
      }),
    ).rejects.toMatchObject({ cause: { code: '23503' } });
  });

  it('should reject an adoption event outside accepted or skipped', async ({
    connection,
  }) => {
    const ownerId = randomUUID();
    await expect(
      connection.db.transaction(async (tx) => {
        const recordId = randomUUID();
        const jobId = randomUUID();
        const snapshotId = randomUUID();
        const runId = randomUUID();
        const proposalId = randomUUID();
        await tx.insert(records).values({
          id: recordId,
          ownerId,
          code: 'R-ADOPT',
          unitKind: 'single',
        });
        await tx.insert(jobs).values({
          id: jobId,
          ownerId,
          kind: 'analysis',
          resourceId: recordId,
          state: 'done',
          stage: 'complete',
        });
        await tx.insert(analysisSnapshots).values({
          id: snapshotId,
          ownerId,
          recordId,
          recordRevision: 1,
          analysisInputVersion: 1,
          evidenceVersion: 1,
          content: {},
          contentHash: randomUUID(),
        });
        await tx.insert(analysisRuns).values({
          id: runId,
          ownerId,
          recordId,
          jobId,
          snapshotId,
          status: 'ready',
          modelSelection: {},
          profileVersion: '1',
          promptVersion: '1',
          schemaVersion: '1',
        });
        await tx.insert(proposals).values({
          id: proposalId,
          runId,
          field: 'description',
          before: {},
          proposed: { text: 'proposed' },
        });
        await tx.insert(adoptionEvents).values({
          id: randomUUID(),
          runId,
          proposalId,
          status: 'deferred',
          recordRevision: 1,
        });
      }),
    ).rejects.toMatchObject({
      cause: { code: '23514', constraint_name: 'adoption_events_status_ck' },
    });
  });
});
