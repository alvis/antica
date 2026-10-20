import {
  knowledgeEntryDetailV2Schema,
  knowledgeDetailSchema,
} from '@antica/contracts';

import { Prisma } from '../../generated/client.js';

import { legacyDetailSql, legacyEvidenceSql } from './search-legacy-detail.js';

import type { KnowledgeDiscovery } from '@antica/application/ports';
import type { KnowledgeReadV2 } from '@antica/contracts';

import type { KnowledgeContext } from './v2.js';

/**
 * reads either envelope generation and all legacy evidence under one SQL snapshot
 * @param context authenticated owner and database connection
 * @param id exact entry identity
 * @param input pinned revision selection
 * @returns authoritative detail with its persisted hash, or null
 */
export async function readKnowledgeDetail(
  context: KnowledgeContext,
  id: string,
  input: KnowledgeReadV2,
): ReturnType<KnowledgeDiscovery['detail']> {
  const { tx, ownerId } = context;
  const revision =
    input.view === 'saved'
      ? Prisma.sql`e.latest_saved_revision`
      : input.view === 'revision' || input.revision !== undefined
        ? Prisma.sql`${input.revision}::int`
        : Prisma.sql`e.current_revision`;
  const rows = await tx.$queryRaw<
    Array<{ detail: unknown; contentHash: string; version: number }>
  >(Prisma.sql`
 WITH selected AS (SELECT e.id,e.display_code,e.created_at,e.updated_at,e.current_revision,r.revision,r.status,r.saved_by,r.content,r.content_hash,r.content_schema_version,r.created_at revision_created_at
 FROM knowledge_entries e JOIN knowledge_revisions r ON r.entry_id=e.id AND r.revision=${revision} WHERE e.owner_id=${ownerId} AND e.id=${id}::uuid),
 ${legacyEvidenceSql(ownerId)}
 SELECT content_schema_version version,content_hash "contentHash",CASE WHEN content_schema_version=2 THEN
 jsonb_build_object('id',id,'displayCode',display_code,'revision',revision,'status',status,'savedBy',saved_by,'contentHash',content_hash,
 'createdAt',to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'updatedAt',to_char(revision_created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'content',content)
 ELSE ${legacyDetailSql(ownerId)} END detail FROM selected s`);
  const row = rows[0];
  if (!row) {
    return null;
  }

  return {
    detail:
      row.version === 2
        ? knowledgeEntryDetailV2Schema.parse(row.detail)
        : knowledgeDetailSchema.parse(row.detail),
    contentHash: row.contentHash,
  };
}
