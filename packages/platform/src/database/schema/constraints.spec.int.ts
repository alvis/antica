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

describe(
  'persisted knowledge taxonomy constraints',
  { timeout: 30_000 },
  () => {
    it('should reject a foreign-owner topic parent', async ({ connection }) => {
      const parentId = randomUUID();
      await connection.db
        .$executeRaw`INSERT INTO topics (id, owner_id, content_id, facet) VALUES (${parentId}::uuid, ${randomUUID()}, 'parent', 'category')`;
      await expect(
        connection.db
          .$executeRaw`INSERT INTO topics (id, owner_id, content_id, facet, parent_id) VALUES (${randomUUID()}::uuid, ${randomUUID()}, 'child', 'category', ${parentId}::uuid)`,
      ).rejects.toMatchObject({
        meta: { driverAdapterError: { cause: { originalCode: '23503' } } },
      });
    });

    it('should reject a cross-owner revision-topic link', async ({
      connection,
    }) => {
      const ownerId = randomUUID();
      const entryId = randomUUID();
      const topicId = randomUUID();
      await connection.db
        .$executeRaw`INSERT INTO knowledge_entries (id, owner_id, display_code, current_revision) VALUES (${entryId}::uuid, ${ownerId}, 'KN-TOPIC', 1)`;
      await connection.db
        .$executeRaw`INSERT INTO knowledge_revisions (entry_id, revision, status, title_zh_hant, summary_zh_hant, content, content_hash) VALUES (${entryId}::uuid, 1, 'draft', '瓷', '瓷器', '{}', 'hash')`;
      await connection.db
        .$executeRaw`INSERT INTO topics (id, owner_id, content_id, facet) VALUES (${topicId}::uuid, ${randomUUID()}, 'foreign', 'category')`;
      await expect(
        connection.db
          .$executeRaw`INSERT INTO knowledge_revision_topics (owner_id, entry_id, revision, topic_id, applicability) VALUES (${ownerId}, ${entryId}::uuid, 1, ${topicId}::uuid, 'general')`,
      ).rejects.toMatchObject({
        meta: { driverAdapterError: { cause: { originalCode: '23503' } } },
      });
    });

    it('should allow multilingual preferred labels and aliases but reject a second preferred label in one language', async ({
      connection,
    }) => {
      const ownerId = randomUUID();
      const topicId = randomUUID();
      await connection.db
        .$executeRaw`INSERT INTO topics (id, owner_id, content_id, facet) VALUES (${topicId}::uuid, ${ownerId}, 'ceramics', 'category')`;
      await connection.db
        .$executeRaw`INSERT INTO topic_labels (id, owner_id, topic_id, language, text, normalized_text, kind) VALUES (${randomUUID()}::uuid, ${ownerId}, ${topicId}::uuid, 'en', 'Ceramics', 'ceramics', 'preferred'), (${randomUUID()}::uuid, ${ownerId}, ${topicId}::uuid, 'zh-Hant', '陶瓷', '陶瓷', 'preferred'), (${randomUUID()}::uuid, ${ownerId}, ${topicId}::uuid, 'en', 'Pottery', 'pottery', 'alias')`;
      expect(
        await connection.db
          .$queryRaw`SELECT language, text, kind::text FROM topic_labels WHERE topic_id = ${topicId}::uuid ORDER BY language, text`,
      ).toEqual([
        { language: 'en', text: 'Ceramics', kind: 'preferred' },
        { language: 'en', text: 'Pottery', kind: 'alias' },
        { language: 'zh-Hant', text: '陶瓷', kind: 'preferred' },
      ]);
      await expect(
        connection.db
          .$executeRaw`INSERT INTO topic_labels (id, owner_id, topic_id, language, text, normalized_text, kind) VALUES (${randomUUID()}::uuid, ${ownerId}, ${topicId}::uuid, 'en', 'Earthenware', 'earthenware', 'preferred')`,
      ).rejects.toMatchObject({
        meta: { driverAdapterError: { cause: { originalCode: '23505' } } },
      });
    });

    it('should accept ordered related topics and reject a self-relation', async ({
      connection,
    }) => {
      const ownerId = randomUUID();
      const [fromId, toId] = [randomUUID(), randomUUID()].sort();
      await connection.db
        .$executeRaw`INSERT INTO topics (id, owner_id, content_id, facet) VALUES (${fromId}::uuid, ${ownerId}, 'bronze', 'material'), (${toId}::uuid, ${ownerId}, 'casting', 'technique')`;
      await connection.db
        .$executeRaw`INSERT INTO topic_relations (owner_id, from_topic_id, to_topic_id, relation) VALUES (${ownerId}, ${fromId}::uuid, ${toId}::uuid, 'related')`;
      expect(
        await connection.db
          .$queryRaw`SELECT from_topic_id, to_topic_id FROM topic_relations WHERE owner_id = ${ownerId}`,
      ).toEqual([{ from_topic_id: fromId, to_topic_id: toId }]);
      await expect(
        connection.db
          .$executeRaw`INSERT INTO topic_relations (owner_id, from_topic_id, to_topic_id, relation) VALUES (${ownerId}, ${fromId}::uuid, ${fromId}::uuid, 'related')`,
      ).rejects.toMatchObject({
        meta: { driverAdapterError: { cause: { originalCode: '23514' } } },
      });
    });

    it('should persist an owner-scoped claim, citation, translation and authority mapping', async ({
      connection,
    }) => {
      const ownerId = randomUUID();
      const entryId = randomUUID();
      const topicId = randomUUID();
      const sourceId = randomUUID();
      const versionId = randomUUID();
      const locatorId = randomUUID();
      const citationId = randomUUID();
      const claimId = randomUUID();
      await connection.db
        .$executeRaw`INSERT INTO knowledge_entries (id, owner_id, display_code, current_revision) VALUES (${entryId}::uuid, ${ownerId}, 'KN-CLAIM', 1)`;
      await connection.db
        .$executeRaw`INSERT INTO knowledge_revisions (entry_id, revision, status, title_zh_hant, summary_zh_hant, content, content_hash) VALUES (${entryId}::uuid, 1, 'draft', '瓷', '瓷器', '{}', 'hash')`;
      await connection.db
        .$executeRaw`INSERT INTO topics (id, owner_id, content_id, facet) VALUES (${topicId}::uuid, ${ownerId}, 'porcelain', 'material')`;
      await connection.db
        .$executeRaw`INSERT INTO knowledge_revision_topics (owner_id, entry_id, revision, topic_id, applicability) VALUES (${ownerId}, ${entryId}::uuid, 1, ${topicId}::uuid, 'specific')`;
      await connection.db
        .$executeRaw`INSERT INTO sources (id, owner_id, kind, title, author_status, access) VALUES (${sourceId}::uuid, ${ownerId}, 'web', 'Museum', 'unknown', 'link_only')`;
      await connection.db
        .$executeRaw`INSERT INTO source_versions (id, source_id, owner_id, source_hash, metadata_snapshot, captured_at, status, text_index_status, image_index_status) VALUES (${versionId}::uuid, ${sourceId}::uuid, ${ownerId}, ${randomUUID()}, '{}', now(), 'registered', 'registered', 'registered')`;
      await connection.db
        .$executeRaw`INSERT INTO source_locators (id, source_id, source_version_id, kind, url, retrieved_at, excerpt_as_retrieved) VALUES (${locatorId}::uuid, ${sourceId}::uuid, ${versionId}::uuid, 'web', 'https://example.invalid/object', now(), 'Porcelain bowl')`;
      await connection.db
        .$executeRaw`INSERT INTO citations (id, locator_id, relation, availability, verification) VALUES (${citationId}::uuid, ${locatorId}::uuid, 'supports', 'available', 'located')`;
      await connection.db
        .$executeRaw`INSERT INTO authority_mappings (id, owner_id, topic_id, authority, authority_id, uri, relation, retrieved_at, citation_id, review_state) VALUES (${randomUUID()}::uuid, ${ownerId}, ${topicId}::uuid, 'wikidata', 'Q130693', 'https://www.wikidata.org/entity/Q130693', 'close', now(), ${citationId}::uuid, 'pending')`;
      await connection.db
        .$executeRaw`INSERT INTO cited_claims (id, owner_id, entry_id, revision, claim_key, section, ordinal, original_text, original_language, statement_type, scope, qualifiers, support_state, review_state) VALUES (${claimId}::uuid, ${ownerId}, ${entryId}::uuid, 1, 'material', 'features', 0, 'Porcelain bowl', 'en', 'source_attribution', '{}', '{}', 'cited', 'pending')`;
      await connection.db
        .$executeRaw`INSERT INTO cited_claim_citations (claim_id, citation_id) VALUES (${claimId}::uuid, ${citationId}::uuid)`;
      await connection.db
        .$executeRaw`INSERT INTO language_variants (id, claim_id, language, kind, text, method, review_state, source_text_hash) VALUES (${randomUUID()}::uuid, ${claimId}::uuid, 'zh-Hant', 'translation', '瓷碗', 'human', 'pending', 'hash')`;
      expect(
        await connection.db
          .$queryRaw`SELECT t.content_id, rt.revision, c.claim_key, cc.citation_id, v.text, a.authority_id FROM topics t JOIN knowledge_revision_topics rt ON rt.topic_id = t.id JOIN cited_claims c ON c.entry_id = rt.entry_id AND c.revision = rt.revision JOIN cited_claim_citations cc ON cc.claim_id = c.id JOIN language_variants v ON v.claim_id = c.id JOIN authority_mappings a ON a.topic_id = t.id WHERE t.owner_id = ${ownerId}`,
      ).toEqual([
        {
          content_id: 'porcelain',
          revision: 1,
          claim_key: 'material',
          citation_id: citationId,
          text: '瓷碗',
          authority_id: 'Q130693',
        },
      ]);
    });

    it('should retain import checkpoints, review candidates and pinned corpus installation receipts', async ({
      connection,
    }) => {
      const ownerId = randomUUID();
      const entryId = randomUUID();
      const sourceId = randomUUID();
      const objectId = randomUUID();
      const jobId = randomUUID();
      const runId = randomUUID();
      const releaseId = randomUUID();
      const installId = randomUUID();
      await connection.db
        .$executeRaw`INSERT INTO knowledge_entries (id, owner_id, display_code, current_revision) VALUES (${entryId}::uuid, ${ownerId}, 'KN-INSTALL', 1)`;
      await connection.db
        .$executeRaw`INSERT INTO knowledge_revisions (entry_id, revision, status, title_zh_hant, summary_zh_hant, content, content_hash) VALUES (${entryId}::uuid, 1, 'draft', '瓷', '瓷器', '{}', 'hash')`;
      await connection.db
        .$executeRaw`INSERT INTO sources (id, owner_id, kind, title, author_status, access) VALUES (${sourceId}::uuid, ${ownerId}, 'structured_open_data', 'Museum object', 'unknown', 'link_only')`;
      await connection.db
        .$executeRaw`INSERT INTO external_objects (id, owner_id, provider, object_id, source_id, canonical_record_url, last_seen_at, status) VALUES (${objectId}::uuid, ${ownerId}, 'met', '44831', ${sourceId}::uuid, 'https://example.invalid/44831', now(), 'active')`;
      await connection.db
        .$executeRaw`INSERT INTO jobs (id, owner_id, kind, resource_id, state, stage) VALUES (${jobId}::uuid, ${ownerId}, 'source_ingestion', ${sourceId}::uuid, 'pending', 'queued')`;
      await connection.db
        .$executeRaw`INSERT INTO import_runs (id, owner_id, job_id, provider, query, query_hash, adapter_version, request_key, status, counts) VALUES (${runId}::uuid, ${ownerId}, ${jobId}::uuid, 'met', '{}', 'query-hash', '1', 'import-1', 'running', '{}')`;
      await connection.db
        .$executeRaw`INSERT INTO import_items (run_id, provider_object_id, status) VALUES (${runId}::uuid, '44831', 'staged')`;
      await connection.db
        .$executeRaw`INSERT INTO review_diffs (id, owner_id, import_run_id, entry_id, candidate_revision, candidate_content_hash, changes, status) VALUES (${randomUUID()}::uuid, ${ownerId}, ${runId}::uuid, ${entryId}::uuid, 1, 'hash', '{}', 'pending')`;
      await connection.db
        .$executeRaw`INSERT INTO corpus_releases (id, corpus_id, version, schema_version, manifest_hash, status, rights_notices) VALUES (${releaseId}::uuid, ${randomUUID()}, '1.0.0', 2, 'manifest-hash', 'draft', '[]')`;
      await connection.db
        .$executeRaw`INSERT INTO corpus_installs (id, owner_id, release_id, request_key, status, counts) VALUES (${installId}::uuid, ${ownerId}, ${releaseId}::uuid, 'install-1', 'running', '{}')`;
      await connection.db
        .$executeRaw`INSERT INTO corpus_install_items (install_id, content_id, entry_id, revision, content_hash, disposition) VALUES (${installId}::uuid, 'museum:met:object:44831', ${entryId}::uuid, 1, 'hash', 'created')`;
      expect(
        await connection.db
          .$queryRaw`SELECT o.object_id, i.attempt_count, d.candidate_revision FROM external_objects o JOIN import_runs r ON r.owner_id = o.owner_id JOIN import_items i ON i.run_id = r.id JOIN review_diffs d ON d.import_run_id = r.id WHERE o.owner_id = ${ownerId}`,
      ).toEqual([
        { object_id: '44831', attempt_count: 0, candidate_revision: 1 },
      ]);
      expect(
        await connection.db
          .$queryRaw`SELECT r.version, i.status::text, item.content_id, item.revision, item.disposition::text FROM corpus_releases r JOIN corpus_installs i ON i.release_id = r.id JOIN corpus_install_items item ON item.install_id = i.id WHERE i.owner_id = ${ownerId}`,
      ).toEqual([
        {
          version: '1.0.0',
          status: 'running',
          content_id: 'museum:met:object:44831',
          revision: 1,
          disposition: 'created',
        },
      ]);
    });
  },
);
