import { knowledgeContentEnvelopeV2Schema } from '@antica/contracts';

import { Prisma } from '../../generated/client.js';

import { canonicalJson } from './canonical.js';
import { projectKnowledge } from './projections.js';

import type { Transaction } from '../../transaction.js';

/** controls whether the legacy audit repairs provenance and saved pointers */
export interface KnowledgeAuditOptions {
  readonly apply?: boolean;
}

/** reports legacy integrity findings and each permitted repair */
export interface KnowledgeAuditReport {
  readonly invalidDrafts: number;
  readonly missingSavedPointers: number;
  readonly projectionGaps: number;
  readonly lines: readonly string[];
}

/**
 * audits revision provenance and projections without rewriting saved envelopes
 * @param tx transaction owning the audit and any repairs
 * @param options explicit repair selection; omission is dry run
 * @returns finding counts and row-level audit lines
 */
export async function auditKnowledge(
  tx: Transaction,
  options: KnowledgeAuditOptions = {},
): Promise<KnowledgeAuditReport> {
  const drafts = await tx.$queryRaw<AuditRow[]>(Prisma.sql`
    select e.owner_id as "ownerId", r.entry_id as "entryId", r.revision
    from knowledge_revisions r join knowledge_entries e on e.id = r.entry_id
    where r.status = 'draft' and r.saved_by is not null
    order by e.owner_id, r.entry_id, r.revision
  `);
  const pointers = await tx.$queryRaw<AuditRow[]>(Prisma.sql`
    select e.owner_id as "ownerId", e.id as "entryId", max(r.revision)::integer as revision
    from knowledge_entries e join knowledge_revisions r on r.entry_id = e.id
    where e.latest_saved_revision is null and r.status = 'saved'
    group by e.owner_id, e.id order by e.owner_id, e.id
  `);
  const gaps = await findProjectionGaps(tx);
  if (options.apply) {
    for (const row of drafts) {
      await tx.knowledgeRevisions.updateMany({
        where: {
          entryId: row.entryId,
          revision: row.revision,
          status: 'draft',
          savedBy: { not: null },
          knowledgeEntries: { ownerId: row.ownerId },
        },
        data: { savedBy: null },
      });
    }
    for (const row of pointers) {
      await tx.knowledgeEntries.updateMany({
        where: {
          id: row.entryId,
          ownerId: row.ownerId,
          latestSavedRevision: null,
        },
        data: { latestSavedRevision: row.revision },
      });
    }
  }

  return {
    invalidDrafts: drafts.length,
    missingSavedPointers: pointers.length,
    projectionGaps: gaps.length,
    lines: [
      ...drafts.map((row) =>
        auditLine(options.apply ? 'clear-draft-savedBy' : 'invalid-draft', row),
      ),
      ...pointers.map((row) =>
        auditLine(
          options.apply ? 'backfill-latest-saved' : 'missing-saved-pointer',
          row,
        ),
      ),
      ...gaps.map((row) => auditLine('projection-gap', row)),
    ],
  };
}

interface AuditRow {
  readonly ownerId: string;
  readonly entryId: string;
  readonly revision: number;
}

/**
 * identifies each finding without disclosing source content
 * @param action observed issue or permitted repair
 * @param row affected owner and pinned revision
 * @returns one machine-readable audit line
 */
function auditLine(action: string, row: AuditRow): string {
  return JSON.stringify({ action, ...row });
}

/**
 * compares projection values independently of database timestamps and row ordering
 * @param projection rebuilt or persisted projection collections
 * @param projection.claims immutable cited claim rows
 * @param projection.citations claim evidence links
 * @param projection.variants claim language variants
 * @param projection.topics revision topic links
 * @returns canonical comparison fingerprint
 */
function projectionFingerprint(projection: {
  readonly claims: readonly object[];
  readonly citations: readonly object[];
  readonly variants: readonly object[];
  readonly topics: readonly object[];
}): string {
  return canonicalJson(
    Object.fromEntries(
      Object.entries(projection).map(([key, rows]) => [
        key,
        rows
          .map((row) => {
            const { createdAt: _createdAt, ...values } = row as Record<
              string,
              unknown
            >;

            return canonicalJson(JSON.parse(JSON.stringify(values)));
          })
          .sort(),
      ]),
    ),
  );
}

/**
 * compares every v2 revision with its deterministic normalized projection
 * @param tx transaction providing an audit snapshot
 * @returns exact revisions with missing or inconsistent projections
 */
async function findProjectionGaps(tx: Transaction): Promise<AuditRow[]> {
  const revisions = await tx.knowledgeRevisions.findMany({
    where: { contentSchemaVersion: 2 },
    include: { knowledgeEntries: { select: { ownerId: true } } },
    orderBy: [{ entryId: 'asc' }, { revision: 'asc' }],
  });
  const gaps: AuditRow[] = [];
  for (const row of revisions) {
    const auditRow = {
      ownerId: row.knowledgeEntries.ownerId,
      entryId: row.entryId,
      revision: row.revision,
    };
    const parsed = knowledgeContentEnvelopeV2Schema.safeParse(row.content);
    if (!parsed.success) {
      gaps.push(auditRow);
      continue;
    }
    const expected = projectKnowledge(auditRow, parsed.data);
    const claims = await tx.citedClaim.findMany({
      where: { entryId: row.entryId, revision: row.revision },
    });
    const claimIds = claims.map((claim) => claim.id);
    const [citations, variants, topics] = await Promise.all([
      tx.citedClaimCitation.findMany({ where: { claimId: { in: claimIds } } }),
      tx.languageVariant.findMany({ where: { claimId: { in: claimIds } } }),
      tx.knowledgeRevisionTopic.findMany({
        where: { entryId: row.entryId, revision: row.revision },
      }),
    ]);
    if (
      projectionFingerprint(expected) !==
      projectionFingerprint({ claims, citations, variants, topics })
    ) {
      gaps.push(auditRow);
    }
  }

  return gaps;
}
