import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { corpusFileSchema } from '@antica/contracts';

import { installCorpusRelease } from '../../../packages/application/src/knowledge/corpus-install.js';
import { createKnowledgeService } from '../../../packages/application/src/knowledge/service.js';
import { createCorpusConnection } from '../../../packages/platform/src/database/repositories/corpus-connection.js';
import { createCorpusInstallRepository } from '../../../packages/platform/src/database/repositories/corpus-install.js';
import { createKnowledgeSearchRepository } from '../../../packages/platform/src/database/repositories/knowledge/search.js';
import { createTransactionPort } from '../../../packages/platform/src/database/transaction.js';

import { canonicalJson, sha256 } from './canonical.js';
import { readCorpusDirectory } from './cli.js';
import { loadCorpusInstallRequest } from './install.js';
import { scoreRelevance } from './relevance-metrics.js';

import type { KnowledgeContentEnvelopeV2 } from '@antica/contracts';

import type { Database } from '../../../packages/platform/src/database/connection.js';

import type { CorpusOutput } from './cli.js';
import type { RelevanceObservation } from './relevance-metrics.js';

const expectedQuestionCount = 20;
const recallLimit = 5;
type OwnerQueries = Extract<
  ReturnType<typeof corpusFileSchema.parse>,
  { kind: 'owner_queries' }
>;
interface SavedEntry {
  contentId: string;
  revision: number;
  content: KnowledgeContentEnvelopeV2;
}

const directory = fileURLToPath(
  new URL('../../../corpus/antica/v1', import.meta.url),
);
const output: CorpusOutput = {
  stdout: (text) => {
    process.stdout.write(text);
  },
  stderr: (text) => {
    process.stderr.write(text);
  },
};

/**
 * Installs and saves a fresh evaluation owner, then measures the unchanged owner questions.
 * requires ANTICA_TEST_DATABASE_URL with a test or tests database-name segment
 * Reports misses without turning provisional relevance targets into a CI gate.
 * @param io report and error output
 * @returns zero after measured execution, one after an operational failure
 */
export async function runRelevanceCommand(
  io: CorpusOutput = output,
): Promise<number> {
  try {
    const url = process.env.ANTICA_TEST_DATABASE_URL;
    if (!url || !/(?:^|_)tests?(?:_|$)/.test(new URL(url).pathname.slice(1))) {
      throw new Error(
        'ANTICA_TEST_DATABASE_URL must name a throwaway test database',
      );
    }
    const queryText = readFileSync(`${directory}/queries/owner.json`, 'utf8');
    const queries = corpusFileSchema.parse(JSON.parse(queryText));
    if (
      queries.kind !== 'owner_queries' ||
      queries.questions.length !== expectedQuestionCount
    ) {
      throw new Error('Expected the unchanged 20 owner questions');
    }
    const ownerId = randomUUID();
    const request = loadCorpusInstallRequest([
      '--owner-id',
      ownerId,
      '--release',
      '1.0.0',
      '--request-key',
      randomUUID(),
    ]);
    const connection = createCorpusConnection(url);
    try {
      await installCorpusRelease(
        request,
        createCorpusInstallRepository(connection.db),
      );
      const saved = await saveEvaluationEntries(connection.db, ownerId);
      const observations = await searchQuestions(
        connection.db,
        ownerId,
        queries,
      );
      const projections = await connection.db.knowledgeSearchDocument.findMany({
        where: { ownerId },
        select: { tokenizerVersion: true },
        distinct: ['tokenizerVersion'],
      });
      const metrics = summarizeObservations(observations);
      io.stdout(
        `${JSON.stringify({ provisional: queries.provisional, ownerId, installed: saved.length, saved: saved.length, mode: process.env.ANTICA_KNOWLEDGE_SEARCH_MODE ?? 'postgres', tokenizerVersions: projections.map((row) => row.tokenizerVersion), hashes: { corpus: sha256(canonicalJson(readCorpusDirectory(directory))), queries: sha256(queryText), savedReviewedSubset: sha256(canonicalJson(saved)) }, relevantGrade: '>0', averaging: 'macro over questions with positive grades', ...metrics, observations, targets: { recallAt5: 0.8, mrrAt10: 0.65 }, sqlStatements: connection.statementCount() })}\n`,
      );

      return 0;
    } finally {
      await connection.close();
    }
  } catch (error) {
    io.stderr(`${(error as Error).message}\n`);

    return 1;
  }
}

/**
 * Saves installed drafts through the application action without adding reviews.
 * @param db evaluation database
 * @param ownerId fresh evaluation owner
 * @returns frozen saved revision content
 */
async function saveEvaluationEntries(
  db: Database,
  ownerId: string,
): Promise<SavedEntry[]> {
  const service = createKnowledgeService(
    createTransactionPort(db),
    { now: () => new Date().toISOString() },
    { create: randomUUID },
  );
  const installed = await db.corpusInstallItem.findMany({
    where: { install: { ownerId } },
    orderBy: { contentId: 'asc' },
  });
  const saved: SavedEntry[] = [];
  for (const item of installed) {
    const read = await service.getV2(ownerId, item.entryId, {
      view: 'working',
    });
    if (!read.success) {
      throw new Error(read.error.message);
    }
    const detail = read.data.detail;
    if ('entry' in detail) {
      throw new Error('Expected an available working revision');
    }
    const result = await service.updateV2(ownerId, item.entryId, {
      requestKey: randomUUID(),
      expectedRevision: detail.revision,
      content: detail.content,
      status: 'saved',
      reviewDecisions: [],
      translationDecisions: [],
    });
    if (!result.success) {
      throw new Error(result.error.message);
    }
    saved.push({
      contentId: item.contentId,
      revision: result.data.revision,
      content: result.data.content,
    });
  }

  return saved;
}

/**
 * Runs the frozen text verbatim against saved search.
 * @param db evaluation database
 * @param ownerId fresh evaluation owner
 * @param queries validated question set
 * @returns measured rankings with original grades
 */
async function searchQuestions(
  db: Database,
  ownerId: string,
  queries: OwnerQueries,
): Promise<RelevanceObservation[]> {
  const observations: RelevanceObservation[] = [];
  for (const question of queries.questions) {
    const result = await createKnowledgeSearchRepository(db, ownerId).search({
      q: question.text,
      locale: question.language === 'en' ? 'en' : 'zh-Hant',
      view: 'saved',
      limit: 10,
    });
    if (!result.success) {
      throw new Error(result.error.message);
    }
    observations.push({
      ...question,
      retrieved: result.data.hits.map((hit) => hit.contentId ?? hit.id),
    });
  }

  return observations;
}

/**
 * Summarizes measured rankings without changing their grades.
 * @param observations frozen grades and rankings
 * @returns overall, category metrics and missing positive grades
 */
function summarizeObservations(observations: readonly RelevanceObservation[]): {
  overall: ReturnType<typeof scoreRelevance>;
  categories: Record<string, ReturnType<typeof scoreRelevance>>;
  misses: Array<{
    id: string;
    category: string;
    retrieved: readonly string[];
    missingAt5: string[];
  }>;
} {
  const overall = scoreRelevance(observations);
  const categories = Object.fromEntries(
    [...new Set(observations.map((row) => row.category))].map((category) => [
      category,
      scoreRelevance(observations.filter((row) => row.category === category)),
    ]),
  );
  const misses = observations
    .map((row) => ({
      id: row.id,
      category: row.category,
      retrieved: row.retrieved,
      missingAt5: row.relevance
        .filter(
          (item) =>
            item.grade > 0 &&
            !row.retrieved.slice(0, recallLimit).includes(item.entryId),
        )
        .map((item) => item.entryId),
    }))
    .filter((row) => row.missingAt5.length > 0);

  return { overall, categories, misses };
}
