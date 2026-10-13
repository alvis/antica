import { performance } from 'node:perf_hooks';

import {
  createLocalTextRetrieval,
  developmentTextIndex,
} from '@antica/platform/search';

import { digestSnapshot } from './digest.js';
import { scoreRetrieval } from './metrics.js';

import type {
  IndexIdentity,
  RetrievalSnapshot,
} from '@antica/application/ports';
import type { TextSearchEntry } from '@antica/platform/search';

import type { RetrievalCorpus } from './dataset.js';
import type { RetrievalScores } from './metrics.js';

/** preserves a query ranking and its evidence independently from inference */
export interface RetrievalEvaluation {
  readonly queryId: string;
  readonly rankedIds: readonly string[];
  readonly scores: RetrievalScores | null;
  readonly snapshot: RetrievalSnapshot | null;
  readonly elapsedMs: number;
  readonly error: unknown;
}

/** records an independently versioned text-retrieval benchmark */
export interface RetrievalReport {
  readonly kind: 'retrieval';
  readonly adapterKind: 'development';
  readonly metric: 'lexical-overlap';
  readonly provenance: string;
  readonly corpusDigest: string;
  readonly corpus: RetrievalCorpus;
  readonly queryIndex: IndexIdentity;
  readonly storedIndex: IndexIdentity;
  readonly limit: number;
  readonly evaluations: readonly RetrievalEvaluation[];
  readonly limitations: readonly string[];
}

/**
 * compares lexical retrieval with fixed source texts and authored query judgments
 * @param corpus authored source texts and relevance judgments
 * @param limit ranking cutoff
 * @param queryIndex independently configured requested index identity
 * @returns candidate rankings, original locators, and retrieval-only metrics
 */
export async function evaluateRetrieval(
  corpus: RetrievalCorpus,
  limit: number,
  queryIndex: IndexIdentity = developmentTextIndex,
): Promise<RetrievalReport> {
  const entries = createTextEntries(corpus);
  const adapter = createLocalTextRetrieval({
    index: developmentTextIndex,
    readEntries: async () => entries,
  });
  const evaluations: RetrievalEvaluation[] = [];
  for (const query of corpus.queries) {
    const start = performance.now();
    const ranked = await adapter.search({ q: query.text, limit }, queryIndex);
    if (!ranked.success) {
      evaluations.push(captureRetrievalFailure(query.id, start, ranked.error));
      continue;
    }
    const snapshot = await adapter.snapshot(query.text, queryIndex);
    if (!snapshot.success) {
      evaluations.push(
        captureRetrievalFailure(query.id, start, snapshot.error),
      );
      continue;
    }
    const rankedIds = ranked.data.items.map((entry) => entry.id);
    evaluations.push({
      queryId: query.id,
      rankedIds,
      scores: scoreRetrieval({ rankedIds, relevance: query.relevance, limit }),
      snapshot: snapshot.data,
      elapsedMs: performance.now() - start,
      error: null,
    });
  }

  return {
    kind: 'retrieval',
    adapterKind: 'development',
    metric: 'lexical-overlap',
    provenance:
      'Authored synthetic excerpts located within local fixtures; example.invalid URLs were not fetched and external availability is unverified.',
    corpusDigest: digestSnapshot(corpus),
    corpus,
    queryIndex,
    storedIndex: developmentTextIndex,
    limit,
    evaluations,
    limitations: [
      'Authored synthetic relevance labels are not authenticity ground truth.',
      'Lexical retrieval scores do not measure image retrieval, learned embeddings, or inference quality.',
    ],
  };
}

/**
 * retains a retrieval failure without assigning an artificial score
 * @param queryId failed query identity
 * @param start monotonic query start time
 * @param error adapter failure
 * @returns unscored failed evaluation
 */
function captureRetrievalFailure(
  queryId: string,
  start: number,
  error: unknown,
): RetrievalEvaluation {
  return {
    queryId,
    rankedIds: [],
    scores: null,
    snapshot: null,
    elapsedMs: performance.now() - start,
    error,
  };
}

/**
 * materializes explicitly synthetic web-excerpt locators
 * @param corpus authored source corpus
 * @returns entries accepted by the production text adapter
 */
export function createTextEntries(
  corpus: RetrievalCorpus,
): readonly TextSearchEntry[] {
  return corpus.documents.map((document) => ({
    summary: {
      id: document.id,
      displayCode: document.id,
      revision: 1,
      titleZhHant: document.text,
      kinds: ['inspection'],
      status: 'saved',
      summaryZhHant: document.text,
      citationCount: 1,
    },
    citation: {
      id: document.id,
      relation: 'background',
      availability: 'link_only',
      verification: 'located',
      locator: {
        kind: 'web',
        sourceId: '30000000-0000-4000-8000-000000000005',
        sourceVersionId: corpus.version,
        url: `https://example.invalid/synthetic/${document.id}`,
        retrievedAt: '2026-01-01T00:00:00.000Z',
        snapshotAssetId: null,
        blockId: document.id,
        excerptAsRetrieved: document.text,
      },
    },
    contentAsRetrieved: document.text,
    sourceRegionId: null,
  }));
}
