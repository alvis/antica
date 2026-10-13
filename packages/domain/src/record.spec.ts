import { describe, expect, it } from 'vitest';

import {
  calculateAnalysisFreshness,
  isAnalysisRelevantRecordField,
} from './record.js';

describe('fn:calculateAnalysisFreshness', () => {
  it('should keep a record without a run visibly unanalyzed', () => {
    expect(calculateAnalysisFreshness(null, 4)).toBe('unanalyzed');
  });

  it('should mark the exact analyzed input current', () => {
    expect(calculateAnalysisFreshness(4, 4)).toBe('current');
  });

  it('should identify new evidence without implying a new run has started', () => {
    expect(calculateAnalysisFreshness(4, 5)).toBe('outdated');
  });
});

describe('fn:isAnalysisRelevantRecordField', () => {
  it('should invalidate input when the collector changes an observed description', () => {
    expect(isAnalysisRelevantRecordField('description')).toBe(true);
  });

  it('should keep private storage location and acquisition costs outside the analysis input', () => {
    expect(
      ['location', 'acquisition'].map(isAnalysisRelevantRecordField),
    ).toEqual([false, false]);
  });
});
