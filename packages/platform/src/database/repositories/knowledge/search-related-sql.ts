import { tokenizerVersion } from '../../../search/text/tokenizer.js';
import { Prisma } from '../../generated/client.js';

import { exactTitleAliasSql } from './search-exact.js';
import { reviewedExcerptSql } from './search-excerpt.js';

import type { RelatedKnowledgeQuery } from '@antica/contracts';

// Unicode mark ranges generated with the tokenizer runtime Unicode database.
const combiningMarks =
  '[̀-ͯ҃-҉֑-ֽֿׁ-ׂׄ-ׇׅؐ-ًؚ-ٰٟۖ-ۜ۟-ۤۧ-۪ۨ-ܑۭܰ-݊ަ-ް߫-߽߳ࠖ-࠙ࠛ-ࠣࠥ-ࠧࠩ-࡙࠭-࡛ࢗ-࢟࣊-ࣣ࣡-ःऺ-़ा-ॏ॑-ॗॢ-ॣঁ-ঃ়া-ৄে-ৈো-্ৗৢ-ৣ৾ਁ-ਃ਼ਾ-ੂੇ-ੈੋ-੍ੑੰ-ੱੵઁ-ઃ઼ા-ૅે-ૉો-્ૢ-ૣૺ-૿ଁ-ଃ଼ା-ୄେ-ୈୋ-୍୕-ୗୢ-ୣஂா-ூெ-ைொ-்ௗఀ-ఄ఼ా-ౄె-ైొ-్ౕ-ౖౢ-ౣಁ-ಃ಼ಾ-ೄೆ-ೈೊ-್ೕ-ೖೢ-ೣೳഀ-ഃ഻-഼ാ-ൄെ-ൈൊ-്ൗൢ-ൣඁ-ඃ්ා-ුූෘ-ෟෲ-ෳัิ-ฺ็-๎ັິ-ຼ່-໎༘-༹༙༵༷༾-༿ཱ-྄྆-྇ྍ-ྗྙ-ྼ࿆ါ-ှၖ-ၙၞ-ၠၢ-ၤၧ-ၭၱ-ၴႂ-ႍႏႚ-ႝ፝-፟ᜒ-᜕ᜲ-᜴ᝒ-ᝓᝲ-ᝳ឴-៓៝᠋-᠍᠏ᢅ-ᢆᢩᤠ-ᤫᤰ-᤻ᨗ-ᨛᩕ-ᩞ᩠-᩿᩼᪰-᫝᫠-᫫ᬀ-ᬄ᬴-᭄᭫-᭳ᮀ-ᮂᮡ-ᮭ᯦-᯳ᰤ-᰷᳐-᳔᳒-᳨᳭᳴᳷-᳹᷀-᷿⃐-⃰⳯-⵿⳱ⷠ-〪ⷿ-゙〯-゚꙯-꙲ꙴ-꙽ꚞ-ꚟ꛰-꛱ꠂ꠆ꠋꠣ-ꠧ꠬ꢀ-ꢁꢴ-ꣅ꣠-꣱ꣿꤦ-꤭ꥇ-꥓ꦀ-ꦃ꦳-꧀ꧥꨩ-ꨶꩃꩌ-ꩍꩻ-ꩽꪰꪲ-ꪴꪷ-ꪸꪾ-꪿꫁ꫫ-ꫯꫵ-꫶ꯣ-ꯪ꯬-꯭ﬞ︀-️︠-𐇽𐋠︯𐍶-𐍺𐨁-𐨃𐨅-𐨆𐨌-𐨏𐨸-𐨿𐨺𐫥-𐫦𐴤-𐴧𐵩-𐵭𐺫-𐺬𐻺-𐻿𐽆-𐽐𐾂-𐾅𑀀-𑀂𑀸-𑁆𑁰𑁳-𑁴𑁿-𑂂𑂰-𑂺𑃂𑄀-𑄂𑄧-𑄴𑅅-𑅆𑅳𑆀-𑆂𑆳-𑇀𑇉-𑇌𑇎-𑇏𑈬-𑈷𑈾𑉁𑋟-𑋪𑌀-𑌃𑌻-𑌼𑌾-𑍄𑍇-𑍈𑍋-𑍍𑍗𑍢-𑍣𑍦-𑍬𑍰-𑍴𑎸-𑏀𑏅𑏅𑎸-𑏊𑏌-𑏐𑏒𑏡-𑏢𑐵-𑑆𑑞𑒰-𑓃𑖯-𑖵𑖸-𑗀𑗜-𑗝𑘰-𑙀𑚫-𑚷𑜝-𑜫𑠬-𑠺𑤰-𑤵𑤷-𑤸𑤻-𑤾𑥀𑥂-𑥃𑧑-𑧗𑧚-𑧠𑧤𑨁-𑨊𑨳-𑨹𑨻-𑨾𑩇𑩑-𑩛𑪊-𑪙𑭠-𑭧𑰯-𑰶𑰸-𑰿𑲒-𑲧𑲩-𑲶𑴱-𑴶𑴺𑴼-𑴽𑴿-𑵅𑵇𑶊-𑶎𑶐-𑶑𑶓-𑶗𑻳-𑻶𑼀-𑼁𑼃𑼴-𑼺𑼾-𑽂𑽚𓑀𓑇-𓑕𖄞-𖫰𖄯-𖫴𖬰-𖬶𖽏𖽑-𖾇𖾏-𖾒𖿤𖿰-𖿱𛲝-𛲞𜼀-𜼭𜼰-𜽆𝅥-𝅩𝅭-𝅲𝅻-𝆂𝆅-𝆋𝆪-𝆭𝉂-𝉄𝨀-𝨶𝨻-𝩬𝩵𝪄𝪛-𝪟𝪡-𝪯𞀀-𞀆𞀈-𞀘𞀛-𞀡𞀣-𞀤𞀦-𞀪𞂏𞄰-𞄶𞊮𞋬-𞋯𞓬-𞓯𞗮-𞗯𞛣𞛦𞛮-𞛯𞛵𞣐-𞣖𞥄-𞥊󠄀-󠇯]';
const trimCharacters = '\t\n\u000b\f\r                  　﻿';

/**
 * constructs one owner-isolated record and saved-topic matching snapshot
 * @param ownerId authenticated collector
 * @param recordId requested record
 * @param input bounded locale and card count
 * @returns bounded single-statement contextual projection
 */
export function relatedKnowledgeSql(
  ownerId: string,
  recordId: string,
  input: RelatedKnowledgeQuery,
): Prisma.Sql {
  return Prisma.sql`WITH owned_record AS MATERIALIZED (
    SELECT id,record_revision,name,period_label,period_status FROM records WHERE owner_id=${ownerId} AND id=${recordId}::uuid
  ), ${recordFieldsSql(ownerId)}, saved AS MATERIALIZED (
    SELECT e.id entry_id,e.latest_saved_revision revision,r.entry_type,r.content,
      (SELECT d.language FROM knowledge_search_documents d WHERE d.owner_id=e.owner_id AND d.entry_id=e.id AND d.revision=e.latest_saved_revision AND d.tokenizer_version=${tokenizerVersion} ORDER BY (d.language=${input.locale}) DESC,d.language LIMIT 1) language
    FROM knowledge_entries e JOIN knowledge_revisions r ON r.entry_id=e.id AND r.revision=e.latest_saved_revision
    WHERE e.owner_id=${ownerId} AND r.content_schema_version=2 AND r.status='saved' AND EXISTS(SELECT 1 FROM owned_record)
  ), topic_matches AS (
    SELECT DISTINCT s.entry_id,f.field,
      CASE WHEN f.topic_id IS NOT NULL THEN l.text ELSE f.value END value,t.id topic_id,l.text label,0 lane
    FROM saved s JOIN knowledge_revision_topics kt ON kt.owner_id=${ownerId} AND kt.entry_id=s.entry_id AND kt.revision=s.revision
    JOIN topics t ON t.owner_id=kt.owner_id AND t.id=kt.topic_id AND t.retired_at IS NULL
    JOIN topic_labels l ON l.owner_id=t.owner_id AND l.topic_id=t.id
    JOIN fields f ON (f.topic_id=t.id AND (CASE f.field WHEN 'category' THEN 'object_type' ELSE f.field END)=t.facet::text) OR
      (f.topic_id IS NULL AND (f.field='name' OR (CASE f.field WHEN 'category' THEN 'object_type' ELSE f.field END)=t.facet::text) AND f.normalized=l.normalized_text)
    WHERE s.content->'editorialReview'->>'state'='reviewed' AND s.language IS NOT NULL AND char_length(l.text) BETWEEN 1 AND 24000
  ), title_matches AS (
    SELECT s.entry_id,f.field,f.value,NULL::uuid topic_id,title->>'text' label,1 lane
    FROM saved s CROSS JOIN fields f CROSS JOIN LATERAL jsonb_array_elements((s.content->'titles')||(s.content->'aliases')) title
    WHERE f.field='name' AND s.language IS NOT NULL AND f.normalized<>'' AND f.normalized=${normalizedFieldSql(Prisma.sql`title->>'text'`)} AND EXISTS(SELECT 1 FROM knowledge_search_documents d WHERE d.owner_id=${ownerId} AND d.entry_id=s.entry_id AND d.revision=s.revision AND d.tokenizer_version=${tokenizerVersion} AND ${exactTitleAliasSql(Prisma.sql`f.normalized`, Prisma.sql`d.normalized_title_aliases_marks`)})
  ), matches AS MATERIALIZED (
    SELECT * FROM topic_matches UNION SELECT * FROM title_matches
  ), ranked AS (
    SELECT s.*,min(m.lane) lane,count(DISTINCT (m.field,m.topic_id,m.label)) score
    FROM saved s JOIN matches m ON m.entry_id=s.entry_id GROUP BY s.entry_id,s.revision,s.entry_type,s.content,s.language
  ), page AS (
    SELECT * FROM ranked ORDER BY lane,score DESC,entry_id LIMIT ${input.limit}

  ) ${relatedResultSql(ownerId, input)}`;
}

/**
 * mirrors the shared tokenizer's normalization inside the record-reading statement
 * @param value SQL text expression from explicit fields or immutable saved titles
 * @returns accent-folded NFKC lowercase search copy without optional extensions
 */
function normalizedFieldSql(value: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`btrim(normalize(regexp_replace(normalize(lower(normalize(${value},NFKC)),NFD),${combiningMarks},'','g'),NFC),${trimCharacters})`;
}

/**
 * projects bounded localized cards from the saved-match snapshot
 * @param ownerId authenticated collector
 * @param input bounded locale and card count
 * @returns the record-bound response projection
 */
function relatedResultSql(
  ownerId: string,
  input: RelatedKnowledgeQuery,
): Prisma.Sql {
  return Prisma.sql` SELECT jsonb_build_object(
    'recordRevision',r.record_revision,
    'contextHash',encode(sha256(convert_to(jsonb_build_object('id',r.id,'revision',r.record_revision,'fields',
      coalesce((SELECT jsonb_agg(jsonb_build_object('field',field,'value',value) ORDER BY field,value) FROM fields),'[]'::jsonb),
      'tokenizer',${tokenizerVersion}::text)::text,'UTF8')),'hex'),
    'cards',coalesce((SELECT jsonb_agg(jsonb_build_object(
      'entryId',p.entry_id,'revision',p.revision,'title',title->>'text','language',title->>'language','fallback',(title->>'language')<>${input.locale},'kind',p.entry_type,
      'category',coalesce((SELECT jsonb_agg(value ORDER BY value->>'topicId') FROM (
        SELECT jsonb_build_object('topicId',t.id,'label',coalesce((SELECT l.text FROM topic_labels l WHERE l.owner_id=t.owner_id AND l.topic_id=t.id ORDER BY (l.language=${input.locale}) DESC,(l.kind='preferred') DESC,l.language,l.text LIMIT 1),t.content_id)) value
        FROM knowledge_revision_topics kt JOIN topics t ON t.owner_id=kt.owner_id AND t.id=kt.topic_id
        WHERE kt.owner_id=${ownerId} AND kt.entry_id=p.entry_id AND kt.revision=p.revision AND t.facet IN('category','object_type') AND t.retired_at IS NULL ORDER BY t.id LIMIT 100
      ) categories),'[]'::jsonb),
      'matches',(SELECT jsonb_agg(value ORDER BY value->>'field',value->>'topicId',value->>'label') FROM (
        SELECT jsonb_build_object('field',m.field,'value',m.value,'topicId',m.topic_id,'label',m.label,'matchedTokens','[]'::jsonb) value
        FROM matches m WHERE m.entry_id=p.entry_id ORDER BY m.lane,m.field,m.topic_id,m.label LIMIT 100
      ) reasons),
      'excerpt',excerpt.value,
      'providers',coalesce((SELECT jsonb_agg(provider ORDER BY provider) FROM (
        SELECT DISTINCT coalesce(c->'locator'->>'provider',c->'source'->'structuredSnapshot'->>'provider','unknown') provider FROM jsonb_array_elements(p.content->'citations') c
      ) providers),'[]'::jsonb)
    ) ORDER BY p.lane,p.score DESC,p.entry_id)
    FROM page p LEFT JOIN LATERAL (
      SELECT item title FROM jsonb_array_elements(p.content->'titles') item ORDER BY (item->>'language'=${input.locale}) DESC,(item->>'language'=p.language) DESC,item->>'language' LIMIT 1
    ) localized ON true ${reviewedExcerptSql(input.locale)}),'[]'::jsonb)
  ) data FROM owned_record r`;
}

/**
 * resolves collector selections through their owner-private saved entries
 * @param ownerId authenticated collector
 * @returns explicit field identities, terms and reviewed topics
 */
function recordFieldsSql(ownerId: string): Prisma.Sql {
  return Prisma.sql` selected_ids AS (
    SELECT 'category' field,t.category_id entry_id,'object_type' facet FROM record_categories t JOIN owned_record r ON r.id=t.record_id
    UNION ALL SELECT 'material',t.material_id,'material' FROM record_materials t JOIN owned_record r ON r.id=t.record_id
  ), selected AS MATERIALIZED (
    SELECT i.*,r.content,r.content_schema_version,e.latest_saved_revision revision FROM selected_ids i
    JOIN knowledge_entries e ON e.id=i.entry_id AND e.owner_id=${ownerId}
    JOIN knowledge_revisions r ON r.entry_id=e.id AND r.revision=e.latest_saved_revision AND r.status='saved'
    WHERE (r.content_schema_version=1 AND r.content->'kinds' ? i.facet) OR
      (r.content_schema_version=2 AND EXISTS(SELECT 1 FROM knowledge_revision_topics kt JOIN topics t ON t.id=kt.topic_id AND t.owner_id=kt.owner_id WHERE kt.owner_id=${ownerId} AND kt.entry_id=e.id AND kt.revision=r.revision AND t.facet::text=i.facet AND t.retired_at IS NULL))
  ), record_fields AS MATERIALIZED (
    SELECT 'name' field,name value,NULL::uuid topic_id FROM owned_record WHERE name IS NOT NULL AND btrim(name)<>''
    UNION ALL SELECT 'period',period_label,NULL::uuid FROM owned_record WHERE period_status='collectorClaim' AND period_label IS NOT NULL AND btrim(period_label)<>''
    UNION ALL SELECT s.field,term,NULL::uuid FROM selected s CROSS JOIN LATERAL (
      SELECT s.content->>'titleZhHant' term WHERE s.content_schema_version=1
      UNION ALL SELECT jsonb_array_elements_text(s.content->'aliases') WHERE s.content_schema_version=1
      UNION ALL SELECT item->>'text' FROM jsonb_array_elements((s.content->'titles')||(s.content->'aliases')) item WHERE s.content_schema_version=2
    ) terms
    UNION ALL SELECT s.field,l.text,t.id FROM selected s
    JOIN knowledge_revision_topics kt ON kt.owner_id=${ownerId} AND kt.entry_id=s.entry_id AND kt.revision=s.revision
    JOIN topics t ON t.owner_id=kt.owner_id AND t.id=kt.topic_id AND t.facet::text=s.facet AND t.retired_at IS NULL
    JOIN topic_labels l ON l.owner_id=t.owner_id AND l.topic_id=t.id
    WHERE s.content->'editorialReview'->>'state'='reviewed'
  ), fields AS MATERIALIZED (
    SELECT *,${normalizedFieldSql(Prisma.sql`value`)} normalized FROM record_fields WHERE char_length(value)<=24000
)`;
}
