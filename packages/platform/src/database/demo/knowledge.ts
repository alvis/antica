import { randomUUID } from 'node:crypto';

import {
  knowledgeDetailSchema,
  knowledgeEntryDetailV2Schema,
  knowledgeSearchPageSchema,
  knowledgeUpdateV2Schema,
} from '@antica/contracts';

import type { z } from 'zod';

import type {
  KnowledgeEntryDetailV2,
  KnowledgeSearchHit,
} from '@antica/contracts';

import type { SourceCitation } from '@antica/domain';

import type { Database } from '../connection.js';

import type { DemoApi } from './api.js';
import type { VocabularyTerm } from './fixtures.js';

/** a saved corpus claim the seed cites, resolved from `<content id>#<claim key>` */
export interface SavedClaim {
  readonly entryId: string;
  readonly revision: number;
  readonly claimKey: string;
  readonly citationIds: readonly string[];
  readonly entry: KnowledgeEntryDetailV2;
}

/** citation of a saved corpus entry */
export type CorpusCitation =
  KnowledgeEntryDetailV2['content']['citations'][number];

/** saved corpus entries by content id */
export type SavedCorpus = ReadonlyMap<string, KnowledgeEntryDetailV2>;

/**
 * reviews and saves installed corpus entries the way the collector does in the app
 * @param api demo owner session
 * @param contentIds corpus content ids to save
 * @returns the saved revision of every requested entry
 */
export async function saveCorpusEntries(
  api: DemoApi,
  contentIds: readonly string[],
): Promise<SavedCorpus> {
  const hits = await readWorkingHits(api);
  const saved = new Map<string, KnowledgeEntryDetailV2>();
  for (const contentId of contentIds) {
    const hit = hits.find((candidate) => candidate.contentId === contentId);
    if (!hit) {
      throw new Error(
        `Installed corpus entry missing: ${contentId}; run pnpm corpus:install first`,
      );
    }
    saved.set(contentId, await saveEntry(api, hit));
  }

  return saved;
}

/**
 * resolves `<content id>#<claim key>` to the saved claim and its citations
 * @param corpus saved corpus entries
 * @param reference content id and claim key
 * @returns the claim identity used by evidence references
 */
export function resolveSavedClaim(
  corpus: SavedCorpus,
  reference: string,
): SavedClaim {
  const [contentId = '', claimKey = ''] = reference.split('#');
  const entry = corpus.get(contentId);
  const claim = entry?.content.claims.find(
    (candidate) => candidate.claimKey === claimKey,
  );
  if (!entry || !claim) {
    throw new Error(`Saved corpus claim missing: ${reference}`);
  }

  return {
    entryId: entry.id,
    revision: entry.revision,
    claimKey,
    citationIds: claim.citationIds,
    entry,
  };
}

/**
 * maps a structured corpus citation to the analysis contract, which only knows page and web locators
 * @param citation structured corpus citation
 * @returns citation whose web locator keeps the museum record's URL, retrieval time and quote
 */
export function toWebCitation(citation: CorpusCitation): SourceCitation {
  if (citation.locator.kind !== 'structured') {
    throw new Error(`Corpus citation ${citation.id} is not structured`);
  }

  return {
    id: citation.id,
    locator: {
      kind: 'web',
      sourceId: citation.locator.sourceId,
      sourceVersionId: citation.locator.sourceVersionId,
      url: citation.source.canonicalUrl ?? citation.locator.url,
      retrievedAt: citation.locator.retrievedAt,
      snapshotAssetId: null,
      blockId: null,
      excerptAsRetrieved: citation.quote,
    },
    relation: 'supports',
    availability: 'link_only',
    verification: 'located',
  };
}

/**
 * finds a corpus citation among the saved entries
 * @param corpus saved corpus entries
 * @param citationId citation an analysis finding cites
 * @returns the citation with its locator and source
 */
export function findCorpusCitation(
  corpus: SavedCorpus,
  citationId: string,
): CorpusCitation {
  const citation = [...corpus.values()]
    .flatMap((entry) => entry.content.citations)
    .find((candidate) => candidate.id === citationId);
  if (!citation) {
    throw new Error(`Corpus citation missing: ${citationId}`);
  }

  return citation;
}

/**
 * looks up the knowledge entry of a vocabulary term
 * @param vocabulary knowledge entry id per vocabulary title
 * @param term displayed term to look up
 * @returns its knowledge entry id
 */
export function vocabularyEntryId(
  vocabulary: ReadonlyMap<string, string>,
  term: string,
): string {
  const id = vocabulary.get(term);
  if (!id) {
    throw new Error(`Vocabulary term missing: ${term}`);
  }

  return id;
}

/** where to look up and which vocabulary terms to provide */
export interface VocabularyRequest {
  readonly db: Database;
  readonly ownerId: string;
  readonly terms: readonly VocabularyTerm[];
}

/**
 * finds or creates the collector's category and material vocabulary entries
 * @param api demo owner session
 * @param request database, owner and terms to provide
 * @returns knowledge entry id per term title
 */
export async function ensureVocabulary(
  api: DemoApi,
  request: VocabularyRequest,
): Promise<ReadonlyMap<string, string>> {
  const { db, ownerId, terms } = request;
  const ids = new Map<string, string>();
  for (const term of terms) {
    const [existing] = await db.$queryRaw<Array<{ id: string }>>`
      select e.id::text from knowledge_entries e
      join knowledge_revisions r on r.entry_id = e.id and r.revision = e.latest_saved_revision
      where e.owner_id = ${ownerId} and r.content_schema_version = 1
        and r.content->>'titleZhHant' = ${term.title} and r.content->'kinds' ? ${term.kind}
      order by e.created_at limit 1`;
    ids.set(term.title, existing?.id ?? (await createTerm(api, term)));
  }

  return ids;
}

/**
 * creates one saved vocabulary entry without factual claims
 * @param api demo owner session
 * @param term title, aliases and record field of the term
 * @returns the new knowledge entry id
 */
async function createTerm(api: DemoApi, term: VocabularyTerm): Promise<string> {
  const field = term.kind === 'material' ? '材質' : '類別';
  const created = await api.request('/v1/knowledge', knowledgeDetailSchema, {
    method: 'POST',
    body: {
      requestKey: randomUUID(),
      status: 'saved',
      content: {
        titleZhHant: term.title,
        aliases: [...term.aliases],
        kinds: [term.kind],
        otherKindLabel: null,
        summary: {
          textZhHant: `收藏者自訂的${field}用語，用於藏品紀錄的${field}欄；未附來源。`,
          citationIds: [],
          support: 'needs_source',
        },
        history: [],
        features: [],
        applicability: [],
        exampleReferenceImageIds: [],
        relatedEntryIds: [],
        citations: [],
      },
      methodWrites: [],
      linkedMethodIds: [],
      originResearchId: null,
    },
  });

  return created.entry.id;
}

/**
 * reads every working-view hit so entries can be found by content id
 * @param api demo owner session
 * @returns all installed and collector entries
 */
async function readWorkingHits(
  api: DemoApi,
): Promise<readonly KnowledgeSearchHit[]> {
  const hits: KnowledgeSearchHit[] = [];
  let cursor: string | null = null;
  do {
    const query = new URLSearchParams({ view: 'working', limit: '50' });
    if (cursor) {
      query.set('cursor', cursor);
    }
    const page = await api.request(
      `/v1/knowledge/search?${query.toString()}`,
      knowledgeSearchPageSchema,
    );
    hits.push(...page.hits);
    cursor = page.nextCursor;
  } while (cursor);

  return hits;
}

/**
 * reviews the entry, its cited claims and their Traditional Chinese translations, then saves it
 * @param api demo owner session
 * @param hit working-view hit of the entry
 * @returns the saved revision
 */
async function saveEntry(
  api: DemoApi,
  hit: KnowledgeSearchHit,
): Promise<KnowledgeEntryDetailV2> {
  const path = `/v1/knowledge/${hit.id}`;
  const detail = await api.request(
    `${path}?view=working`,
    knowledgeEntryDetailV2Schema,
  );
  const { content } = detail;
  const citedClaims = content.claims.filter(
    (claim) => claim.supportState === 'cited',
  );
  const translations = citedClaims.flatMap((claim) =>
    claim.variants
      .filter(
        (variant) =>
          variant.kind === 'translation' && variant.language === 'zh-Hant',
      )
      .map((variant) => ({ claim, variant })),
  );
  const isReviewed =
    detail.status === 'saved' &&
    content.editorialReview.state === 'reviewed' &&
    citedClaims.every((claim) => claim.review.state === 'reviewed') &&
    translations.every(({ variant }) => variant.review.state === 'reviewed');
  if (isReviewed) {
    return detail;
  }
  const update = reviewedUpdate(detail, { citedClaims, translations });

  return api.request(path, knowledgeEntryDetailV2Schema, {
    method: 'PATCH',
    body: update,
  });
}

/**
 * builds the collector's review and save of an entry
 * @param detail working revision of the entry
 * @param pending cited claims and their zh-Hant translations to mark reviewed
 * @param pending.citedClaims claims with citations
 * @param pending.translations zh-Hant translations of those claims
 * @returns the update request
 */
function reviewedUpdate(
  detail: KnowledgeEntryDetailV2,
  pending: {
    readonly citedClaims: KnowledgeEntryDetailV2['content']['claims'];
    readonly translations: ReadonlyArray<{
      readonly claim: KnowledgeEntryDetailV2['content']['claims'][number];
      readonly variant: KnowledgeEntryDetailV2['content']['claims'][number]['variants'][number];
    }>;
  },
): z.infer<typeof knowledgeUpdateV2Schema> {
  const { content } = detail;
  const { citedClaims, translations } = pending;

  return knowledgeUpdateV2Schema.parse({
    requestKey: randomUUID(),
    expectedRevision: detail.revision,
    status: 'saved',
    content: {
      ...content,
      editorialReview: { state: 'reviewed' },
      claims: content.claims.map((claim) => ({
        ...claim,
        review: { state: claim.review.state },
        variants: claim.variants.map((variant) => ({
          ...variant,
          review: { state: variant.review.state },
        })),
      })),
    },
    reviewDecisions: citedClaims
      .filter((claim) => claim.review.state !== 'reviewed')
      .map((claim) => ({ claimKey: claim.claimKey, state: 'reviewed' })),
    translationDecisions: translations
      .filter(({ variant }) => variant.review.state !== 'reviewed')
      .map(({ claim }) => ({
        claimKey: claim.claimKey,
        language: 'zh-Hant',
        kind: 'translation',
        state: 'reviewed',
      })),
  });
}
