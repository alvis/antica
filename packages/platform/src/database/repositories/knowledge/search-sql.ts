import {
  normalizeSearchText,
  analyzeSearchQuery,
  tokenizerVersion,
} from '../../../search/text/tokenizer.js';
import { Prisma } from '../../generated/client.js';

import { exactTitleAliasSql } from './search-exact.js';
import { reviewedExcerptSql } from './search-excerpt.js';
import { topicRowsSql } from './search-topics.js';

import type { KnowledgeSearchQuery } from '@antica/contracts';

import type { SearchCursor } from './search-cursor.js';
import type { KnowledgeSearchMode } from './search.js';

const maximumQueryPhrases = 64;
const minimumFuzzyLength = 3;

/**
 * prepares parameterized rank expressions and the owner-scoped search snapshot
 * @param ownerId authenticated owner
 * @param input validated filters
 * @param options capability and validated continuation
 * @returns one statement for hits, total, facets and generation
 */
export function knowledgeSearchSql(
  ownerId: string,
  input: KnowledgeSearchQuery,
  options: SearchSqlOptions,
): Prisma.Sql {
  const { mode, position } = options;
  const { q, short, tokens, bigrams, phraseScore, literal, fuzzy } =
    searchExpressions(input, mode);

  return Prisma.sql`WITH RECURSIVE ${topicRowsSql(ownerId, input.locale)},
 query_tokens AS (SELECT token,ordinality,plainto_tsquery('simple',token) query FROM jsonb_array_elements_text(${JSON.stringify(tokens)}::jsonb) WITH ORDINALITY t(token,ordinality)),
 query_bigrams AS (SELECT token,ordinality,plainto_tsquery('simple',token) query FROM jsonb_array_elements_text(${JSON.stringify(bigrams)}::jsonb) WITH ORDINALITY t(token,ordinality)),
 lexical_query AS (SELECT coalesce(string_agg('('||query::text||')',' | '),'')::tsquery any_query FROM query_tokens),
 selected_facets AS (SELECT key facet,value ids FROM jsonb_each(${JSON.stringify(input.topics ?? {})}::jsonb)),
 expanded(facet,id,depth,path) AS (
   SELECT f.facet,t.id,0,ARRAY[t.id] FROM selected_facets f JOIN topic_rows t ON t.facet::text=f.facet AND t.id::text IN(SELECT jsonb_array_elements_text(f.ids))
   UNION ALL SELECT x.facet,t.id,x.depth+1,x.path||t.id FROM expanded x JOIN topic_rows t ON t.parent_id=x.id AND t.facet::text=x.facet WHERE x.depth<16 AND NOT t.id=ANY(x.path)
 ), generation AS (SELECT md5(coalesce(string_agg(value,'|' ORDER BY value),'')) value FROM (
   SELECT e.id::text||':'||e.current_revision||':'||coalesce(e.latest_saved_revision::text,'')||':'||coalesce(string_agg(d.revision||':'||d.language||':'||d.tokenizer_version||':'||d.corpus_generation,';' ORDER BY d.revision,d.language),'') value FROM knowledge_entries e LEFT JOIN knowledge_search_documents d ON d.owner_id=e.owner_id AND d.entry_id=e.id WHERE e.owner_id=${ownerId} GROUP BY e.id
   UNION ALL SELECT summary::text FROM topic_rows) identities),
 documents AS MATERIALIZED (
   SELECT d.*,e.content_id,e.latest_saved_revision,r.content,r.status,r.entry_type,
     coalesce((SELECT jsonb_agg(t.summary ORDER BY t.sort_order,t.id) FROM knowledge_revision_topics kt JOIN topic_rows t ON t.id=kt.topic_id WHERE kt.owner_id=${ownerId} AND kt.entry_id=d.entry_id AND kt.revision=d.revision),'[]'::jsonb) topics,
     ARRAY(SELECT DISTINCT coalesce(c->'locator'->>'provider',c->'source'->'structuredSnapshot'->>'provider','unknown') FROM jsonb_array_elements(r.content->'citations') c) providers,
     least(3,(SELECT count(*)::int FROM jsonb_array_elements(r.content->'claims') c WHERE c->>'supportState'='cited' AND c->'review'->>'state'='reviewed')) support,
     word_matches.tokens matched_tokens,bigram_matches.tokens matched_bigrams,
     CASE WHEN ${q}='' THEN 7 WHEN ${tokens.length > 0} AND ${exactTitleAliasSql(Prisma.sql`${q}`, Prisma.sql`d.normalized_title_aliases_marks`)} THEN 0
       WHEN ${tokens.length > 0} AND (strpos(d.normalized_title_aliases_marks,${q})>0 OR ${phraseScore}>0) THEN 1
       WHEN NOT ${short} AND cardinality(word_matches.tokens)>0 AND cardinality(word_matches.tokens)=(SELECT count(*) FROM query_tokens) THEN 2
       WHEN NOT ${short} AND cardinality(word_matches.tokens)>0 THEN 3
       WHEN NOT ${short} AND cardinality(bigram_matches.tokens)>0 THEN 4
       WHEN ${mode === 'degraded' || short} AND ${tokens.length > 0} AND d.normalized_title_aliases_marks ILIKE ${`%${literal}%`} THEN 5
       WHEN ${tokens.length > 0} AND ${fuzzy}>=0.08 THEN 6 ELSE 9 END lane,
     round((coalesce(word_matches.coverage,0)+CASE WHEN cardinality(word_matches.tokens)=0 THEN cardinality(bigram_matches.tokens) ELSE 0 END
       +ts_rank_cd(d.search_vector,(SELECT any_query FROM lexical_query),32)*0.99)::numeric,8)::float8 score
   FROM knowledge_entries e JOIN knowledge_revisions r ON r.entry_id=e.id AND r.revision=${input.view === 'saved' ? Prisma.sql`e.latest_saved_revision` : Prisma.sql`e.current_revision`}
   JOIN knowledge_search_documents d ON d.owner_id=e.owner_id AND d.entry_id=e.id AND d.revision=r.revision
   CROSS JOIN LATERAL (SELECT ARRAY(SELECT token FROM query_tokens WHERE d.search_vector@@query OR char_length(token)>2 AND strpos(d.normalized_title_aliases_marks,token)>0 ORDER BY ordinality) tokens,
       (SELECT sum(CASE WHEN ts_filter(d.search_vector,ARRAY['A']::"char"[])@@query THEN 4
          WHEN ts_filter(d.search_vector,ARRAY['B']::"char"[])@@query THEN 3
          WHEN ts_filter(d.search_vector,ARRAY['C']::"char"[])@@query THEN 2 ELSE 1 END)
        FROM query_tokens WHERE d.search_vector@@query) coverage
   ) word_matches
   CROSS JOIN LATERAL (SELECT ARRAY(SELECT token FROM query_bigrams WHERE ts_filter(d.search_vector,ARRAY['D']::"char"[])@@query ORDER BY ordinality) tokens) bigram_matches
   WHERE e.owner_id=${ownerId} AND r.content_schema_version=2 AND d.tokenizer_version=${tokenizerVersion}
 ), ranked AS (SELECT *,row_number() OVER(PARTITION BY entry_id ORDER BY lane,score DESC,(language=${input.locale}) DESC,language) language_order FROM documents WHERE lane<9),
 matched AS MATERIALIZED (SELECT *,ARRAY(SELECT f.facet FROM selected_facets f WHERE NOT EXISTS(SELECT 1 FROM expanded x JOIN knowledge_revision_topics kt ON kt.topic_id=x.id AND kt.owner_id=${ownerId} AND kt.entry_id=ranked.entry_id AND kt.revision=ranked.revision WHERE x.facet=f.facet))
   || CASE WHEN ${JSON.stringify(input.providers ?? [])}::jsonb<>'[]'::jsonb AND NOT providers&&ARRAY(SELECT jsonb_array_elements_text(${JSON.stringify(input.providers ?? [])}::jsonb)) THEN ARRAY['provider'] ELSE ARRAY[]::text[] END
   || CASE WHEN ${JSON.stringify(input.languages ?? [])}::jsonb<>'[]'::jsonb AND NOT EXISTS(SELECT 1 FROM knowledge_search_documents ld WHERE ld.owner_id=${ownerId} AND ld.entry_id=ranked.entry_id AND ld.revision=ranked.revision AND ld.language IN(SELECT jsonb_array_elements_text(${JSON.stringify(input.languages ?? [])}::jsonb))) THEN ARRAY['language'] ELSE ARRAY[]::text[] END
   || CASE WHEN ${JSON.stringify(input.entryTypes ?? [])}::jsonb<>'[]'::jsonb AND entry_type::text NOT IN(SELECT jsonb_array_elements_text(${JSON.stringify(input.entryTypes ?? [])}::jsonb)) THEN ARRAY['entryType'] ELSE ARRAY[]::text[] END failures
   FROM ranked WHERE language_order=1),
 filtered AS (SELECT * FROM matched WHERE cardinality(failures)=0),
 page AS (SELECT * FROM filtered WHERE ${position ? Prisma.sql`(lane,-score,-support,coalesce(content_id,entry_id::text),entry_id)>(${position.lane},${-position.score},${-position.support},${position.key},${position.id}::uuid)` : Prisma.sql`true`} ORDER BY lane,score DESC,support DESC,coalesce(content_id,entry_id::text),entry_id LIMIT ${input.limit + 1}),
 facet_values AS (
   SELECT m.entry_id,t.facet::text facet,t.id::text id,m.failures FROM matched m JOIN knowledge_revision_topics kt ON kt.owner_id=${ownerId} AND kt.entry_id=m.entry_id AND kt.revision=m.revision JOIN topic_rows t ON t.id=kt.topic_id
   UNION ALL SELECT entry_id,'provider',unnest(providers),failures FROM matched
   UNION ALL SELECT m.entry_id,'language',d.language,m.failures FROM matched m JOIN knowledge_search_documents d ON d.owner_id=${ownerId} AND d.entry_id=m.entry_id AND d.revision=m.revision
   UNION ALL SELECT entry_id,'entryType',entry_type::text,failures FROM matched),
 facets AS (SELECT facet,id,count(DISTINCT entry_id)::int count FROM facet_values WHERE cardinality(array_remove(failures,facet))=0 GROUP BY facet,id ORDER BY facet,count DESC,id LIMIT 1000)
 ${searchResultSql(input)}`;
}

/**
 * aggregates localized hits with reviewed, supported excerpts
 * @param input display locale and page bounds
 * @returns final JSON projection for the search CTE
 */
function searchResultSql(input: KnowledgeSearchQuery): Prisma.Sql {
  return Prisma.sql` SELECT jsonb_build_object('corpusGeneration',(SELECT value FROM generation),'total',(SELECT count(*)::int FROM filtered),
 'facets',coalesce((SELECT jsonb_agg(jsonb_build_object('facet',facet,'id',id,'count',count) ORDER BY facet,count DESC,id) FROM facets),'[]'::jsonb),
 'positions',coalesce((SELECT jsonb_agg(jsonb_build_object('id',entry_id,'key',coalesce(content_id,entry_id::text),'lane',lane,'score',score,'support',support) ORDER BY lane,score DESC,support DESC,coalesce(content_id,entry_id::text),entry_id) FROM page),'[]'::jsonb),
 'hits',coalesce((SELECT jsonb_agg(jsonb_build_object('id',p.entry_id,'contentId',p.content_id,'revision',p.revision,
   'title',coalesce(title->>'text',''),'language',coalesce(title->>'language',p.language),'fallback',coalesce(title->>'language','')<>${input.locale},'kind',p.entry_type,
   'topics',p.topics,'providers',to_jsonb(p.providers),'status',p.status,'saved',coalesce(p.revision=p.latest_saved_revision,false),'reviewState',p.content->'editorialReview'->>'state',
   'matchReason',CASE p.lane WHEN 0 THEN 'exact_title_alias' WHEN 1 THEN 'exact_mark_phrase' WHEN 2 THEN 'full_text' WHEN 3 THEN 'best_match' WHEN 4 THEN 'bigram' WHEN 5 THEN 'prefix' WHEN 6 THEN 'trigram' ELSE 'browse' END,
   'matchedTokens',to_jsonb(CASE WHEN p.lane=4 THEN p.matched_bigrams WHEN p.lane IN(0,1,5,6) AND cardinality(p.matched_tokens)=0 THEN ARRAY[${normalizeSearchText(input.q ?? '')}] ELSE p.matched_tokens END),
   'excerpt',excerpt.value) ORDER BY lane,score DESC,support DESC,coalesce(content_id,entry_id::text),entry_id)
   FROM page p LEFT JOIN LATERAL(SELECT item title FROM jsonb_array_elements(p.content->'titles') item ORDER BY (item->>'language'=${input.locale}) DESC,(item->>'language'=p.language) DESC,item->>'language' LIMIT 1) localized ON true
   ${reviewedExcerptSql(input.locale)}),'[]'::jsonb)) data`;
}

interface SearchSqlOptions {
  readonly mode: KnowledgeSearchMode;
  readonly position: SearchCursor | null;
}

/**
 * applies the shared tokenizer to bounded query rank expressions
 * @param input validated search text
 * @param mode explicit extension capability
 * @returns parameterized lexical expressions
 */
function searchExpressions(
  input: KnowledgeSearchQuery,
  mode: KnowledgeSearchMode,
): SearchExpressions {
  const q = normalizeSearchText(input.q ?? '');
  const short = /^\p{Script=Han}{1,2}$/u.test(q);
  const { tokens, bigrams } = analyzeSearchQuery(q);
  const phrases = tokens
    .filter((token) =>
      [
        ['「', '」'],
        ['『', '』'],
        ['"', '"'],
        ['“', '”'],
      ].some(([open, close]) => q.includes(`${open}${token}${close}`)),
    )
    .slice(0, maximumQueryPhrases);
  const phraseSql = Prisma.sql`ARRAY(SELECT jsonb_array_elements_text(${JSON.stringify(phrases)}::jsonb))`;
  const phraseScore = Prisma.sql`coalesce((SELECT sum(char_length(phrase)*char_length(phrase))::float8 FROM unnest(${phraseSql}) phrase WHERE CASE WHEN char_length(phrase)>2 THEN strpos(d.normalized_title_aliases_marks,phrase)>0 ELSE 'm:'||phrase=ANY(string_to_array(d.normalized_title_aliases_marks,E'\n')) OR 't:'||phrase=ANY(string_to_array(d.normalized_title_aliases_marks,E'\n')) OR 'a:'||phrase=ANY(string_to_array(d.normalized_title_aliases_marks,E'\n')) END),0)`;
  const literal = q.replace(/[\\%_]/g, '\\$&');
  const fuzzy =
    mode === 'postgres' && !short && [...q].length >= minimumFuzzyLength
      ? Prisma.sql`similarity(d.normalized_title_aliases_marks,${q})`
      : Prisma.sql`0::real`;

  return { q, short, tokens, bigrams, phraseScore, literal, fuzzy };
}
interface SearchExpressions {
  readonly q: string;
  readonly short: boolean;
  readonly tokens: string[];
  readonly bigrams: string[];
  readonly phraseScore: Prisma.Sql;
  readonly literal: string;
  readonly fuzzy: Prisma.Sql;
}
