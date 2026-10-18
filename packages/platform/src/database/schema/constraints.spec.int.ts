import { randomUUID } from 'node:crypto';

import { describe, expect, inject } from 'vitest';

import { createDatabaseTest } from '../spec/fixtures/runner.js';

const url = process.env.ANTICA_TEST_DATABASE_URL;
if (!url) {
  throw new Error(
    'ANTICA_TEST_DATABASE_URL must identify an isolated PostgreSQL database',
  );
}

const resources = inject('platformDatabases');
const it = createDatabaseTest(resources.constraints!);

describe('persisted record constraints', { timeout: 30_000 }, () => {
  it('should accept a positive piece count and reject zero', async ({
    connection,
  }) => {
    const ownerId = randomUUID();
    await expect(
      connection.db.$transaction(async (tx) => {
        const id = randomUUID();
        await tx.records.createMany({
          data: { id, ownerId, code: 'R-1', unitKind: 'set', pieceCount: 2 },
        });
        expect(
          await tx.records.findMany({
            select: { pieceCount: true },
            where: { id },
          }),
        ).toEqual([{ pieceCount: 2 }]);
        await tx.records.createMany({
          data: {
            id: randomUUID(),
            ownerId,
            code: 'R-2',
            unitKind: 'set',
            pieceCount: 0,
          },
        });
      }),
    ).rejects.toMatchObject({
      meta: {
        driverAdapterError: {
          cause: {
            originalCode: '23514',
            originalMessage: expect.stringContaining('records_piece_count_ck'),
          },
        },
      },
    });
  });

  it('should reject a period whose end precedes its start', async ({
    connection,
  }) => {
    await expect(
      connection.db.records.createMany({
        data: {
          id: randomUUID(),
          ownerId: randomUUID(),
          code: 'R-PERIOD',
          unitKind: 'single',
          periodFromYear: 1900,
          periodToYear: 1800,
        },
      }),
    ).rejects.toMatchObject({
      meta: {
        driverAdapterError: {
          cause: {
            originalCode: '23514',
            originalMessage: expect.stringContaining('records_period_year_ck'),
          },
        },
      },
    });
  });
});

describe(
  'persisted media and evidence constraints',
  { timeout: 30_000 },
  () => {
    it('should require exactly one owning resource for an asset', async ({
      connection,
    }) => {
      const ownerId = randomUUID();
      await expect(
        connection.db.$transaction(async (tx) => {
          const recordId = randomUUID();
          const assetId = randomUUID();
          await tx.records.createMany({
            data: {
              id: recordId,
              ownerId,
              code: 'R-MEDIA',
              unitKind: 'single',
            },
          });
          await tx.mediaAssets.createMany({
            data: {
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
            },
          });
          expect(
            await tx.mediaAssets.findMany({
              select: { recordId: true },
              where: { id: assetId },
            }),
          ).toEqual([{ recordId }]);
          await tx.mediaAssets.createMany({
            data: {
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
            },
          });
        }),
      ).rejects.toMatchObject({
        meta: {
          driverAdapterError: {
            cause: {
              originalCode: '23514',
              originalMessage: expect.stringContaining(
                'media_assets_owner_xor_ck',
              ),
            },
          },
        },
      });
    });

    it('should reject a region anchor without region geometry', async ({
      connection,
    }) => {
      const ownerId = randomUUID();
      await expect(
        connection.db.$transaction(async (tx) => {
          const recordId = randomUUID();
          const assetId = randomUUID();
          const viewId = randomUUID();
          await tx.records.createMany({
            data: {
              id: recordId,
              ownerId,
              code: 'R-ANCHOR',
              unitKind: 'single',
            },
          });
          await tx.mediaAssets.createMany({
            data: {
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
            },
          });
          await tx.canonicalViews.createMany({
            data: {
              id: viewId,
              originalAssetId: assetId,
              width: 100,
              height: 100,
              coordinateSpace: 'image_pixels',
              transformToOriginal: [1, 0, 0, 0, 1, 0, 0, 0, 1],
            },
          });
          await tx.evidenceAnchors.createMany({
            data: {
              id: randomUUID(),
              ownerId,
              recordId,
              originalAssetId: assetId,
              canonicalViewId: viewId,
              kind: 'photo',
              scopeKind: 'whole',
            },
          });
          await tx.evidenceAnchors.createMany({
            data: {
              id: randomUUID(),
              ownerId,
              recordId,
              originalAssetId: assetId,
              canonicalViewId: viewId,
              kind: 'photo',
              scopeKind: 'region',
            },
          });
        }),
      ).rejects.toMatchObject({
        meta: {
          driverAdapterError: {
            cause: {
              originalCode: '23514',
              originalMessage: expect.stringContaining(
                'evidence_anchor_scope_ck',
              ),
            },
          },
        },
      });
    });
  },
);

describe('persisted account and workflow behavior', { timeout: 30_000 }, () => {
  it('should remove sessions and accounts when their user is deleted', async ({
    connection,
  }) => {
    const id = randomUUID();
    const sessionId = randomUUID();
    const accountId = randomUUID();
    await connection.db.user.createMany({
      data: { id, name: 'Test collector', email: `${id}@example.invalid` },
    });
    try {
      await connection.db.session.createMany({
        data: {
          id: sessionId,
          userId: id,
          token: randomUUID(),
          expiresAt: new Date('2030-01-01T00:00:00Z'),
        },
      });
      await connection.db.account.createMany({
        data: { id: accountId, userId: id, accountId, providerId: 'test' },
      });

      await connection.db.user.deleteMany({ where: { id } });

      expect(
        await connection.db.session.findMany({
          select: { id: true },
          where: { id: sessionId },
        }),
      ).toEqual([]);
      expect(
        await connection.db.account.findMany({
          select: { id: true },
          where: { id: accountId },
        }),
      ).toEqual([]);
    } finally {
      await connection.db.user.deleteMany({ where: { id } });
    }
  });

  it('should reject duplicate outbox events by name and idempotency key', async ({
    connection,
  }) => {
    const ownerId = randomUUID();
    const idempotencyKey = randomUUID();
    await expect(
      connection.db.$transaction(async (tx) => {
        await tx.outbox.createMany({
          data: {
            eventId: randomUUID(),
            eventName: 'record.created',
            schemaVersion: '1',
            ownerId,
            resourceId: randomUUID(),
            idempotencyKey,
            payload: {},
          },
        });
        await tx.outbox.createMany({
          data: {
            eventId: randomUUID(),
            eventName: 'record.created',
            schemaVersion: '1',
            ownerId,
            resourceId: randomUUID(),
            idempotencyKey,
            payload: {},
          },
        });
      }),
    ).rejects.toMatchObject({
      meta: {
        driverAdapterError: {
          cause: {
            originalCode: '23505',
            originalMessage: expect.stringContaining('outbox_idempotency_uq'),
          },
        },
      },
    });
  });

  it('should reject unknown edit-draft states', async ({ connection }) => {
    const ownerId = randomUUID();
    await expect(
      connection.db.$transaction(async (tx) => {
        const recordId = randomUUID();
        const jobId = randomUUID();
        const secondJobId = randomUUID();
        await tx.records.createMany({
          data: {
            id: recordId,
            ownerId,
            code: 'R-DRAFT',
            unitKind: 'single',
          },
        });
        await tx.jobs.createMany({
          data: {
            id: jobId,
            ownerId,
            kind: 'edit_draft',
            resourceId: recordId,
            state: 'pending',
            stage: 'queued',
          },
        });
        await tx.jobs.createMany({
          data: {
            id: secondJobId,
            ownerId,
            kind: 'edit_draft',
            resourceId: recordId,
            state: 'pending',
            stage: 'queued',
          },
        });
        await tx.editDraftRuns.createMany({
          data: {
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
          },
        });
        await tx.editDraftRuns.createMany({
          data: {
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
          },
        });
      }),
    ).rejects.toMatchObject({
      meta: {
        driverAdapterError: {
          cause: {
            originalCode: '23514',
            originalMessage: expect.stringContaining(
              'edit_draft_runs_status_ck',
            ),
          },
        },
      },
    });
  });
});

describe(
  'persisted research ownership and analysis outcomes',
  { timeout: 30_000 },
  () => {
    it('should reject attaching another owner’s knowledge entry to a source version', async ({
      connection,
    }) => {
      const ownerId = randomUUID();
      const otherOwnerId = randomUUID();
      await expect(
        connection.db.$transaction(async (tx) => {
          const sourceId = randomUUID();
          const sourceVersionId = randomUUID();
          const ownEntryId = randomUUID();
          await tx.sources.createMany({
            data: {
              id: sourceId,
              ownerId,
              kind: 'web',
              title: 'Catalog',
              authorStatus: 'unknown',
              access: 'online',
            },
          });
          await tx.sourceVersions.createMany({
            data: {
              id: sourceVersionId,
              sourceId,
              ownerId,
              sourceHash: randomUUID(),
              metadataSnapshot: {},
              capturedAt: '2026-10-13T00:00:00Z',
              status: 'registered',
              textIndexStatus: 'registered',
              imageIndexStatus: 'registered',
            },
          });
          await tx.knowledgeEntries.createMany({
            data: {
              id: ownEntryId,
              ownerId,
              displayCode: 'K-1',
              currentRevision: 1,
            },
          });
          await tx.sourceKnowledgeDrafts.createMany({
            data: { ownerId, sourceVersionId, entryId: ownEntryId },
          });
          const foreignEntryId = randomUUID();
          await tx.knowledgeEntries.createMany({
            data: {
              id: foreignEntryId,
              ownerId: otherOwnerId,
              displayCode: 'K-1',
              currentRevision: 1,
            },
          });
          await tx.sourceKnowledgeDrafts.createMany({
            data: { ownerId, sourceVersionId, entryId: foreignEntryId },
          });
        }),
      ).rejects.toMatchObject({
        meta: { driverAdapterError: { cause: { originalCode: '23503' } } },
      });
    });

    it('should reject an adoption event outside accepted or skipped', async ({
      connection,
    }) => {
      const ownerId = randomUUID();
      await expect(
        connection.db.$transaction(async (tx) => {
          const recordId = randomUUID();
          const jobId = randomUUID();
          const snapshotId = randomUUID();
          const runId = randomUUID();
          const proposalId = randomUUID();
          await tx.records.createMany({
            data: {
              id: recordId,
              ownerId,
              code: 'R-ADOPT',
              unitKind: 'single',
            },
          });
          await tx.jobs.createMany({
            data: {
              id: jobId,
              ownerId,
              kind: 'analysis',
              resourceId: recordId,
              state: 'done',
              stage: 'complete',
            },
          });
          await tx.analysisSnapshots.createMany({
            data: {
              id: snapshotId,
              ownerId,
              recordId,
              recordRevision: 1,
              analysisInputVersion: 1,
              evidenceVersion: 1,
              content: {},
              contentHash: randomUUID(),
            },
          });
          await tx.analysisRuns.createMany({
            data: {
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
            },
          });
          await tx.proposals.createMany({
            data: {
              id: proposalId,
              runId,
              field: 'description',
              before: {},
              proposed: { text: 'proposed' },
            },
          });
          await tx.adoptionEvents.createMany({
            data: {
              id: randomUUID(),
              runId,
              proposalId,
              status: 'deferred',
              recordRevision: 1,
            },
          });
        }),
      ).rejects.toMatchObject({
        meta: {
          driverAdapterError: {
            cause: {
              originalCode: '23514',
              originalMessage: expect.stringContaining(
                'adoption_events_status_ck',
              ),
            },
          },
        },
      });
    });
  },
);
