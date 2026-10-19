import { knowledgeContentEnvelopeV2Schema } from '@antica/contracts';

import {
  normalizeSearchText,
  tokenizeSearchText,
  tokenizerVersion,
} from '../../../search/text/tokenizer.js';
import { Prisma } from '../../generated/client.js';

import type { KnowledgeContentEnvelopeV2 } from '@antica/contracts';

import type { Transaction } from '../../transaction.js';

import type { KnowledgeContext } from './v2.js';

/** identity of the immutable envelope whose search copy is being written */
export interface SearchProjectionIdentity {
  readonly entryId: string;
  readonly revision: number;
}

/**
 * projects every available language in the caller's revision transaction
 * @param context existing transaction and authenticated owner
 * @param identity exact immutable revision
 * @param content complete original envelope
 */
export async function writeKnowledgeSearch(
  context: KnowledgeContext,
  identity: SearchProjectionIdentity,
  content: KnowledgeContentEnvelopeV2,
): Promise<void> {
  const { tx, ownerId } = context;
  const labels = await tx.topicLabel.findMany({
    where: {
      ownerId,
      topicId: { in: content.topics.map((topic) => topic.topicId) },
    },
    select: { text: true, language: true },
  });
  const documents = searchDocuments({ ownerId, identity, content }, labels);
  await tx.$executeRaw(Prisma.sql`INSERT INTO knowledge_search_documents (owner_id,entry_id,revision,language,tokenizer_version,corpus_generation,title_tokens,alias_tokens,topic_tokens,claim_tokens,source_tokens,normalized_title_aliases_marks)
    SELECT "ownerId","entryId",revision,language,"tokenizerVersion",txid_current(),"titleTokens","aliasTokens","topicTokens","claimTokens","sourceTokens","normalizedTitleAliasesMarks"
    FROM jsonb_to_recordset(${JSON.stringify(documents)}::jsonb) AS d("ownerId" text,"entryId" uuid,revision int,language text,"tokenizerVersion" text,"titleTokens" text,"aliasTokens" text,"topicTokens" text,"claimTokens" text,"sourceTokens" text,"normalizedTitleAliasesMarks" text)
    ON CONFLICT (owner_id,entry_id,revision,language) DO UPDATE SET tokenizer_version=excluded.tokenizer_version,corpus_generation=excluded.corpus_generation,title_tokens=excluded.title_tokens,alias_tokens=excluded.alias_tokens,topic_tokens=excluded.topic_tokens,claim_tokens=excluded.claim_tokens,source_tokens=excluded.source_tokens,normalized_title_aliases_marks=excluded.normalized_title_aliases_marks
    WHERE (knowledge_search_documents.tokenizer_version,knowledge_search_documents.title_tokens,knowledge_search_documents.alias_tokens,knowledge_search_documents.topic_tokens,knowledge_search_documents.claim_tokens,knowledge_search_documents.source_tokens,knowledge_search_documents.normalized_title_aliases_marks)
    IS DISTINCT FROM (excluded.tokenizer_version,excluded.title_tokens,excluded.alias_tokens,excluded.topic_tokens,excluded.claim_tokens,excluded.source_tokens,excluded.normalized_title_aliases_marks)`);
}

/**
 * idempotently rebuilds historical, saved and working v2 projections
 * @param tx caller-owned transaction or database connection
 * @param ownerId owner whose existing revisions are rebuilt
 * @returns number of visited revisions
 */
export async function backfillKnowledgeSearch(
  tx: Transaction,
  ownerId: string,
): Promise<number> {
  const revisions = await tx.knowledgeRevisions.findMany({
    where: { contentSchemaVersion: 2, knowledgeEntries: { ownerId } },
    select: { entryId: true, revision: true, content: true },
  });
  for (const revision of revisions) {
    await writeKnowledgeSearch(
      { tx, ownerId },
      revision,
      knowledgeContentEnvelopeV2Schema.parse(revision.content),
    );
  }

  return revisions.length;
}

/**
 * builds language-specific token lanes from the immutable envelope
 * @param context owner and revision envelope
 * @param labels localized taxonomy labels and aliases
 * @returns generated-column-safe projection records
 */
function searchDocuments(
  context: ProjectionContext,
  labels: readonly ProjectionLabel[],
): SearchDocument[] {
  const { content } = context;
  const languages = [
    ...new Set(
      [
        ...content.titles,
        ...content.aliases,
        ...labels,
        ...content.citations.flatMap((citation) =>
          citation.source.languages.map((language) => ({ language })),
        ),
        ...content.claims.flatMap((claim) => [
          { language: claim.originalLanguage },
          ...claim.variants,
        ]),
      ].map((item) => item.language),
    ),
  ];

  return languages.map((language) =>
    searchDocument({ ...context, language }, labels),
  );
}

/**
 * projects one language into weighted token and compact match lanes
 * @param context pinned envelope and selected language
 * @param labels localized topic terms
 * @returns one SQL record
 */
function searchDocument(
  context: LanguageProjectionContext,
  labels: readonly ProjectionLabel[],
): SearchDocument {
  const { ownerId, identity, content, language } = context;

  const titles = content.titles
    .filter((title) => title.language === language)
    .map((title) => title.text);
  const aliases = content.aliases
    .filter((alias) => alias.language === language)
    .map((alias) => alias.text);
  const topics = labels
    .filter((label) => label.language === language)
    .map((label) => label.text);
  const claims = content.claims.flatMap((claim) => [
    ...(claim.originalLanguage === language ? [claim.originalText] : []),
    ...claim.variants
      .filter((variant) => variant.language === language)
      .map((variant) => variant.text),
  ]);
  const sources = content.citations
    .filter((citation) => citation.source.languages.includes(language))
    .flatMap((citation) => [
      citation.source.title,
      citation.quote,
      citation.locator.excerpt,
    ]);
  const words = (values: readonly string[]): string =>
    values.flatMap((text) => tokenizeSearchText(text).tokens).join(' ');
  const bigrams = [
    ...titles,
    ...aliases,
    ...topics,
    ...claims,
    ...sources,
  ].flatMap((text) => tokenizeSearchText(text).bigrams);
  const compact = [
    ...titles.map((text) => `t:${normalizeSearchText(text)}`),
    ...aliases.map((text) => `a:${normalizeSearchText(text)}`),
    ...topics.map((text) => `m:${normalizeSearchText(text)}`),
  ].join('\n');

  return {
    ownerId,
    entryId: identity.entryId,
    revision: identity.revision,
    language,
    tokenizerVersion,
    titleTokens: words(titles),
    aliasTokens: words(aliases),
    topicTokens: words(topics),
    claimTokens: words(claims),
    sourceTokens: [words(sources), ...bigrams].join(' '),
    normalizedTitleAliasesMarks: compact,
  };
}

interface ProjectionContext {
  readonly ownerId: string;
  readonly identity: SearchProjectionIdentity;
  readonly content: KnowledgeContentEnvelopeV2;
}
interface ProjectionLabel {
  readonly text: string;
  readonly language: string;
}
interface LanguageProjectionContext extends ProjectionContext {
  readonly language: string;
}
interface SearchDocument {
  ownerId: string;
  entryId: string;
  revision: number;
  language: string;
  tokenizerVersion: string;
  titleTokens: string;
  aliasTokens: string;
  topicTokens: string;
  claimTokens: string;
  sourceTokens: string;
  normalizedTitleAliasesMarks: string;
}
