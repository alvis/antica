import { describe, expect, it } from '@jest/globals';

import { recordAnalysisState } from './record-analysis-state';

import type { AnalysisRunDetail, RecordDetail } from '@antica/contracts';

/** a latest-run status and record freshness pair */
type Case = {
  status: AnalysisRunDetail['status'] | undefined;
  freshness: RecordDetail['analysisFreshness'];
};

const runId = '00000000-0000-4000-8000-000000000010';

describe('fn:recordAnalysisState', () => {
  it('should report a saved record without a run as not yet analysed', () => {
    expect(
      recordAnalysisState(
        { latestRunId: null, analysisFreshness: 'unanalyzed' },
        undefined,
      ),
    ).toBe('unanalysed');
  });

  it.each([
    { status: 'queued', freshness: 'unanalyzed' },
    { status: 'running', freshness: 'unanalyzed' },
    { status: 'running', freshness: 'outdated' },
    { status: undefined, freshness: 'unanalyzed' },
  ] satisfies Case[])(
    'should report a $status run of a $freshness record as running',
    ({ status, freshness }) => {
      expect(
        recordAnalysisState(
          { latestRunId: runId, analysisFreshness: freshness },
          status,
        ),
      ).toBe('running');
    },
  );

  it.each([
    { status: 'failed', freshness: 'unanalyzed', expected: 'failed' },
    { status: 'failed', freshness: 'outdated', expected: 'failed' },
    { status: 'completed', freshness: 'outdated', expected: 'outdated' },
    { status: undefined, freshness: 'outdated', expected: 'outdated' },
    { status: 'completed', freshness: 'current', expected: 'analysed' },
    { status: undefined, freshness: 'current', expected: 'analysed' },
    { status: 'partial', freshness: 'current', expected: 'partial' },
    { status: 'completed', freshness: 'unanalyzed', expected: 'analysed' },
  ] satisfies Array<Case & { expected: string }>)(
    'should report a $status run of a $freshness record as $expected',
    ({ status, freshness, expected }) => {
      expect(
        recordAnalysisState(
          { latestRunId: runId, analysisFreshness: freshness },
          status,
        ),
      ).toBe(expected);
    },
  );

  it.each(['unanalyzed', 'current', 'outdated'] satisfies Array<
    RecordDetail['analysisFreshness']
  >)(
    'should report an unreadable latest run of a %s record as unknown, never running',
    (freshness) => {
      expect(
        recordAnalysisState(
          { latestRunId: runId, analysisFreshness: freshness },
          undefined,
          true,
        ),
      ).toBe('unknown');
    },
  );

  it('should keep a loaded run status even after a later refresh failed', () => {
    expect(
      recordAnalysisState(
        { latestRunId: runId, analysisFreshness: 'unanalyzed' },
        'running',
        true,
      ),
    ).toBe('running');
  });
});
