import { demoAnalyses } from './fixtures/analyses.js';
import { demoConversation } from './fixtures/conversation.js';
import { demoRecords } from './fixtures/records.js';
import { minuteMs, shiftInstant } from './provenance.js';

import type { Database } from '../connection.js';

import type { SeededCollection } from './collection.js';
import type { DemoRecordKey } from './fixtures.js';

/** seeded analysis run id per analysed record */
export type SeededRuns = Readonly<Partial<Record<DemoRecordKey, string>>>;

/**
 * stores the design's dates: `加入` on records, one minute apart on photos, completion times on runs
 * @param db database
 * @param collection seeded records by key
 * @param runs seeded run per analysed record
 */
export async function applyDesignTimeline(
  db: Database,
  collection: SeededCollection,
  runs: SeededRuns,
): Promise<void> {
  for (const demo of demoRecords) {
    const record = collection[demo.key];
    const analysis = demoAnalyses.find(
      (candidate) => candidate.record === demo.key,
    );
    const activity = [
      demo.createdAt,
      ...(analysis ? [analysis.completedAt] : []),
      ...(demoConversation.record === demo.key
        ? [demoConversation.createdAt]
        : []),
    ].map((instant) => new Date(instant).toISOString());
    const lastActivity = activity.reduce(
      (latest, instant) => (instant > latest ? instant : latest),
      activity[0]!,
    );
    await db.$executeRaw`update records set created_at = ${activity[0]}::timestamptz, updated_at = ${lastActivity}::timestamptz where id = ${record.id}::uuid`;
    const assetIds = [
      ...record.photoIds,
      ...(record.receiptId ? [record.receiptId] : []),
    ];
    for (const [index, assetId] of assetIds.entries()) {
      const uploadedAt = shiftInstant(demo.createdAt, (index + 1) * minuteMs);
      await db.$executeRaw`update media_assets set created_at = ${uploadedAt}::timestamptz, updated_at = ${uploadedAt}::timestamptz where id = ${assetId}::uuid`;
    }
    const runId = runs[demo.key];
    if (analysis && runId) {
      const startedAt = shiftInstant(analysis.completedAt, -minuteMs);
      await db.$executeRaw`update evidence_anchors set created_at = ${startedAt}::timestamptz where record_id = ${record.id}::uuid`;
      await db.$executeRaw`update analysis_snapshots set created_at = ${startedAt}::timestamptz where id = (select snapshot_id from analysis_runs where id = ${runId}::uuid)`;
      await db.$executeRaw`update analysis_runs set created_at = ${startedAt}::timestamptz, completed_at = ${analysis.completedAt}::timestamptz where id = ${runId}::uuid`;
      await db.$executeRaw`update action_states set updated_at = ${analysis.completedAt}::timestamptz where run_id = ${runId}::uuid`;
    }
  }
}
