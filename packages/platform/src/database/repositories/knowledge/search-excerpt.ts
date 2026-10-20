import { Prisma } from '../../generated/client.js';

/**
 * selects one supported reviewed claim, retaining original text for stale translations
 * @param locale preferred display language
 * @returns lateral join against the pinned revision aliased as p
 */
export function reviewedExcerptSql(locale: string): Prisma.Sql {
  return Prisma.sql`LEFT JOIN LATERAL(SELECT jsonb_build_object('claimKey',c->>'claimKey','text',coalesce(variant->>'text',c->>'originalText'),'language',coalesce(variant->>'language',c->>'originalLanguage'),'citations',citations.items) value
     FROM jsonb_array_elements(p.content->'claims') c
     LEFT JOIN LATERAL(SELECT v variant FROM jsonb_array_elements(c->'variants') v WHERE v->>'language'=${locale} AND v->'review'->>'state'='reviewed' AND v->>'sourceTextHash'=encode(sha256(convert_to(c->>'originalText','UTF8')),'hex') ORDER BY v->>'kind' LIMIT 1) v ON true
     CROSS JOIN LATERAL(SELECT jsonb_agg(citation ORDER BY citation->>'id') items FROM jsonb_array_elements(p.content->'citations') citation WHERE citation->>'id' IN(SELECT jsonb_array_elements_text(c->'citationIds')) AND citation->>'relation'='supports' AND citation->>'verification'='located') citations
     WHERE c->>'supportState'='cited' AND c->'review'->>'state'='reviewed' AND jsonb_array_length(coalesce(citations.items,'[]'::jsonb))>0
     ORDER BY (c->>'originalLanguage'=${locale} OR variant IS NOT NULL) DESC,(c->>'ordinal')::int,c->>'claimKey' LIMIT 1) excerpt ON true`;
}
