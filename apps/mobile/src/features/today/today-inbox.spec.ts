import { describe, expect, it, jest } from '@jest/globals';

import { inspectionTaskSchema, recordSummarySchema } from '@antica/contracts';

import { run, runId } from '../../saved-analysis.spec.fixtures';

import {
  entry,
  nameChange,
  tagsChange,
} from '../collection/messages/containers/record-messages.spec.fixtures';

import { buildTodayInbox } from './today-inbox';

import type { InspectionTask, RecordSummary } from '@antica/contracts';

import type { TodayRecordState } from './today-inbox';

jest.mock('../../providers/AuthProvider', () => ({ useAuth: jest.fn() }));

/**
 * a recent record on the shelf
 * @param index position, which also names the record
 * @returns the record summary
 */
function summary(index: number): RecordSummary {
  return recordSummarySchema.parse({
    id: `00000000-0000-4000-8000-00000000090${index}`,
    code: `AC-00000${index}`,
    name: index === 3 ? null : `Record ${index}`,
    coverThumbnail: `https://media.example/${index}.jpg`,
    locationLabel: null,
    analysisFreshness: 'current',
    pendingCheckCount: 0,
  });
}

/**
 * a photo request the analysis left for a record
 * @param recordId record it belongs to
 * @param kind what was asked
 * @returns the pending task
 */
function request(
  recordId: string,
  kind: 'capturePhoto' | 'describe' = 'capturePhoto',
): InspectionTask {
  const actionId = '00000000-0000-4000-8000-000000000910';

  return inspectionTaskSchema.parse({
    kind: 'analysisAction',
    recordId,
    runId,
    action: {
      id: actionId,
      kind,
      instruction: '補拍底足與款識',
      reason: '請拍底足與款識。',
    },
    state: {
      runId,
      actionId,
      recordId,
      revision: 1,
      status: 'pending',
      latestResolutionId: null,
      updatedAt: '2026-10-18T14:40:00.000Z',
    },
    latestResolution: null,
  });
}

const completedAt = '2026-10-20T13:46:00.000Z';

describe('fn:buildTodayInbox', () => {
  it('should order finished analyses, then edit cards, then photo requests', () => {
    const records: TodayRecordState[] = [
      { summary: summary(1), entries: [] },
      {
        summary: summary(2),
        entries: [
          entry('assistant', 'Two changes', {
            proposedChanges: [nameChange, tagsChange],
          }),
        ],
      },
      { summary: summary(3), run, runCompletedAt: completedAt, entries: [] },
    ];

    const items = buildTodayInbox(records, [request(summary(1).id)]);

    expect(items.map(({ kind, recordId }) => [kind, recordId])).toEqual([
      ['analysis', summary(3).id],
      ['editCard', summary(2).id],
      ['action', summary(1).id],
    ]);
    expect(items[0]).toMatchObject({
      // a record without a name shows its code
      name: 'AC-000003',
      runId,
      suggestionCount: 2,
      totalCount: 2,
      citationCount: 0,
      completedAt,
    });
    expect(items[1]).toMatchObject({
      changeCount: 2,
      fields: ['name', 'tags'],
    });
  });

  it('should give a record one card, for its most pressing item', () => {
    const items = buildTodayInbox(
      [
        {
          summary: summary(1),
          run,
          entries: [
            entry('assistant', 'A change', { proposedChanges: [nameChange] }),
          ],
        },
      ],
      [request(summary(1).id)],
    );

    expect(items).toHaveLength(1);
    expect(items[0]?.kind).toBe('analysis');
  });

  it('should leave out records that wait on nobody and requests other than photos', () => {
    expect(
      buildTodayInbox(
        [{ summary: summary(1), entries: [] }],
        [request(summary(1).id, 'describe'), request(summary(2).id)],
      ),
    ).toEqual([]);
  });
});
