import { describe, expect, it } from 'vitest';

import { validateEvidenceAnchor } from './anchor.js';

import type { EvidenceInput } from './anchor.js';

const evidence: EvidenceInput = {
  kind: 'image',
  recordId: 'pair',
  componentIds: ['left'],
  originalAssetId: 'original',
  canonicalViewId: 'upright',
  scope: { kind: 'whole' },
};

describe('fn:validateEvidenceAnchor', () => {
  it('should allow whole-image evidence without requiring an artificial crop', () => {
    expect(validateEvidenceAnchor(evidence)).toBe(true);
  });

  it('should preserve a valid region touching the image boundary', () => {
    expect(
      validateEvidenceAnchor({
        ...evidence,
        scope: {
          kind: 'region',
          cropDerivativeId: null,
          region: { kind: 'rect', x: 0.5, y: 0, width: 0.5, height: 1 },
        },
      }),
    ).toBe(true);
  });

  it('should reject a region that extends beyond the original visible evidence', () => {
    expect(
      validateEvidenceAnchor({
        ...evidence,
        scope: {
          kind: 'region',
          cropDerivativeId: null,
          region: { kind: 'rect', x: 0.5, y: 0, width: 0.6, height: 1 },
        },
      }),
    ).toBe(false);
  });

  it('should reject an empty rectangle rather than save an unlocatable mark', () => {
    expect(
      validateEvidenceAnchor({
        ...evidence,
        scope: {
          kind: 'region',
          cropDerivativeId: null,
          region: { kind: 'rect', x: 0, y: 0, width: 0, height: 0.2 },
        },
      }),
    ).toBe(false);
  });

  it('should accept an irregular polygon with visible area', () => {
    expect(
      validateEvidenceAnchor({
        ...evidence,
        scope: {
          kind: 'region',
          cropDerivativeId: null,
          region: {
            kind: 'polygon',
            points: [
              { x: 0, y: 0 },
              { x: 1, y: 0 },
              { x: 0.5, y: 1 },
            ],
          },
        },
      }),
    ).toBe(true);
  });

  it('should reject collinear vertices that cannot enclose visual evidence', () => {
    expect(
      validateEvidenceAnchor({
        ...evidence,
        scope: {
          kind: 'region',
          cropDerivativeId: null,
          region: {
            kind: 'polygon',
            points: [
              { x: 0, y: 0 },
              { x: 0.5, y: 0.5 },
              { x: 1, y: 1 },
            ],
          },
        },
      }),
    ).toBe(false);
  });

  it('should reject a polygon vertex outside the canonical image', () => {
    expect(
      validateEvidenceAnchor({
        ...evidence,
        scope: {
          kind: 'region',
          cropDerivativeId: null,
          region: {
            kind: 'polygon',
            points: [
              { x: -0.1, y: 0 },
              { x: 1, y: 0 },
              { x: 0.5, y: 1 },
            ],
          },
        },
      }),
    ).toBe(false);
  });

  it('should reject a line presented as a polygon', () => {
    expect(
      validateEvidenceAnchor({
        ...evidence,
        scope: {
          kind: 'region',
          cropDerivativeId: null,
          region: {
            kind: 'polygon',
            points: [
              { x: 0, y: 0 },
              { x: 1, y: 1 },
            ],
          },
        },
      }),
    ).toBe(false);
  });
});
