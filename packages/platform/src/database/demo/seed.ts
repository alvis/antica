import { fileURLToPath } from 'node:url';

import { ensureCollectorUser } from '../collector.js';
import { createDatabase } from '../connection.js';

import { insertAnalysisRun } from './analysis.js';
import { connectDemoApi } from './api.js';
import { createCollection, createEvidence } from './collection.js';
import { postConversation } from './conversation.js';
import { demoAnalyses } from './fixtures/analyses.js';
import { demoConversation } from './fixtures/conversation.js';
import { demoRecords } from './fixtures/records.js';
import {
  demoOwnerPhone,
  endToEndOwnerPhone,
  savedCorpusEntries,
  vocabularyTerms,
} from './fixtures.js';
import { ensureVocabulary, saveCorpusEntries } from './knowledge.js';
import { transactionTimeoutMs } from './provenance.js';
import { resetCollectionState } from './reset.js';
import { applyDesignTimeline } from './timeline.js';

import type { Database } from '../connection.js';

import type { DemoApi } from './api.js';
import type { SeededCollection } from './collection.js';
import type { DemoRecordKey } from './fixtures.js';
import type { DemoRunContext } from './provenance.js';
import type { SeededRuns } from './timeline.js';

/** database, running API and OTP inbox the demo seed uses */
export interface DemoSeedParams {
  readonly databaseUrl: string;
  /** API origin reachable from this host */
  readonly apiOrigin: string;
  /** collector phone the API runs with; must be the demo owner */
  readonly phoneNumber: string;
  /** development OTP inbox the API writes codes to */
  readonly inboxPath: string;
}

/** what the seed created, printed as JSON */
export interface DemoSeedSummary {
  readonly ownerPhone: string;
  readonly records: SeededCollection;
  readonly analysisRunIds: SeededRuns;
  readonly editDraftId: string;
  readonly editDraftJobId: string;
  readonly messageIds: readonly string[];
  /** saved corpus entry id per content id */
  readonly savedKnowledge: Readonly<Record<string, string>>;
  /** collector vocabulary entry id per term */
  readonly vocabulary: Readonly<Record<string, string>>;
  /** rows removed before seeding, per table */
  readonly reset: Readonly<Record<string, number>>;
}

/**
 * resets the demo owner's collection and seeds the five design objects through the API and repositories
 * @param params database, API origin, owner phone and OTP inbox
 * @returns ids of everything created
 * @throws {Error} when run in production or for any owner but the demo owner
 */
export async function seedDemo(
  params: DemoSeedParams,
): Promise<DemoSeedSummary> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('The demo seed is development-only');
  }
  if (params.phoneNumber === endToEndOwnerPhone) {
    throw new Error('The demo seed never writes the end-to-end owner');
  }
  if (params.phoneNumber !== demoOwnerPhone) {
    throw new Error(
      `The demo seed only writes the demo owner ${demoOwnerPhone}`,
    );
  }
  const connection = createDatabase({
    url: params.databaseUrl,
    maxConnections: 4,
  });
  try {
    return await seedOwner(connection.db, params);
  } finally {
    await connection.close();
  }
}

/**
 * runs the seed against the demo owner's database
 * @param db database of the demo owner
 * @param params API origin, owner phone and OTP inbox
 * @returns ids of everything created
 */
async function seedOwner(
  db: Database,
  params: DemoSeedParams,
): Promise<DemoSeedSummary> {
  // the API binds one collector per database, so this also proves the database is the demo owner's
  const ownerId = await ensureCollectorUser({
    db,
    phoneNumber: params.phoneNumber,
  });
  const reset = await db.$transaction(
    async (tx) => resetCollectionState(tx, ownerId),
    { timeout: transactionTimeoutMs },
  );
  // a rerun within a minute would otherwise get no code; only the demo owner's throttle row is cleared
  await db.otpSendCooldown.deleteMany({
    where: { phoneNumber: params.phoneNumber },
  });
  const api = await connectDemoApi({
    origin: params.apiOrigin,
    phoneNumber: params.phoneNumber,
    inboxPath: params.inboxPath,
  });
  const corpus = await saveCorpusEntries(api, savedCorpusEntries);
  const vocabulary = await ensureVocabulary(api, {
    db,
    ownerId,
    terms: vocabularyTerms,
  });
  const collection = await createCollection(api, vocabulary);
  const context: DemoRunContext = { db, ownerId, corpus, vocabulary };
  const runs = await analyseRecords(api, context, collection);
  const conversation = await postConversation({
    context,
    api,
    conversation: demoConversation,
    recordId: collection[demoConversation.record].id,
  });
  await applyDesignTimeline(db, collection, runs);

  return {
    ownerPhone: params.phoneNumber,
    records: collection,
    analysisRunIds: runs,
    editDraftId: conversation.editDraftId,
    editDraftJobId: conversation.jobId,
    messageIds: conversation.messageIds,
    savedKnowledge: Object.fromEntries(
      [...corpus].map(([contentId, entry]) => [contentId, entry.id]),
    ),
    vocabulary: Object.fromEntries(vocabulary),
    reset,
  };
}

/**
 * anchors the cited photos and writes each designed analysis run
 * @param api demo owner session
 * @param context owner context with saved knowledge
 * @param collection seeded records
 * @returns run id per analysed record
 */
async function analyseRecords(
  api: DemoApi,
  context: DemoRunContext,
  collection: SeededCollection,
): Promise<SeededRuns> {
  const runs: Partial<Record<DemoRecordKey, string>> = {};
  for (const analysis of demoAnalyses) {
    const record = collection[analysis.record];
    const demo = demoRecords.find(
      (candidate) => candidate.key === analysis.record,
    )!;
    const evidenceByAngle = await createEvidence(api, {
      record,
      demo,
      labels: analysis.findings.flatMap((finding) => finding.evidenceAngles),
    });
    runs[analysis.record] = await insertAnalysisRun({
      context,
      analysis,
      recordId: record.id,
      evidenceByAngle,
    });
  }

  return runs;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const databaseUrl = process.env.DATABASE_URL;
  const inboxPath = process.env.ANTICA_DEV_OTP_INBOX;
  if (!databaseUrl || !inboxPath) {
    throw new Error(
      'DATABASE_URL and ANTICA_DEV_OTP_INBOX are required; see the demo seed in packages/platform/src/database/README.md',
    );
  }
  const summary = await seedDemo({
    databaseUrl,
    inboxPath,
    apiOrigin: process.env.ANTICA_SEED_API_URL ?? 'http://127.0.0.1:8080',
    phoneNumber: process.env.ANTICA_COLLECTOR_PHONE ?? demoOwnerPhone,
  });
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}
