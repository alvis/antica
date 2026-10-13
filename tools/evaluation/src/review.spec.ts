import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createDevelopmentModels } from '@antica/platform/ai';

import { mkdtemp, rm, writeFile } from 'node:fs/promises';

import { compareInference } from './comparison.js';
import { readSnapshot } from './dataset.js';
import { digestSnapshot } from './digest.js';
import { readReviews } from './review.js';

describe('fn:readReviews', () => {
  it('should preserve explicit human judgments only for the matching snapshot and model', async () => {
    const snapshot = await readSnapshot('synthetic-no-evidence-v1');
    const models = createDevelopmentModels();
    const initial = await compareInference({
      snapshot,
      modelIds: ['development:evidence-v1'],
      profileVersion: 'evaluation-v1',
      catalog: models.catalog,
      model: models.analysis,
    });
    const outputDigest = initial.evaluations[0]?.outputDigest;
    const directory = await mkdtemp(join(tmpdir(), 'antica-reviews-'));
    try {
      const path = join(directory, 'reviews.json');
      const humanReview = {
        reviewer: 'Test reviewer',
        notes: 'Authored test annotation',
        unsupportedClaims: 'pass',
        uncertaintyHandling: 'pass',
        sourceDisagreement: 'not-applicable',
        traditionalChinese: 'pending',
        nextActionUsefulness: 'fail',
      };
      await writeFile(
        path,
        JSON.stringify({
          snapshotDigest: digestSnapshot(snapshot),
          reviews: {
            'development:evidence-v1': {
              outputDigest,
              annotations: humanReview,
            },
          },
        }),
      );
      const reviews = await readReviews(path);
      const params = {
        snapshot,
        modelIds: ['development:evidence-v1'],
        profileVersion: 'evaluation-v1',
        catalog: models.catalog,
        model: models.analysis,
        reviews,
      };
      const report = await compareInference(params);
      expect(report.evaluations[0]?.humanReview).toEqual(humanReview);
      const mismatched = await compareInference({
        ...params,
        reviews: {
          ...reviews,
          reviews: {
            'development:evidence-v1': {
              outputDigest: '0'.repeat(64),
              annotations:
                reviews.reviews['development:evidence-v1']!.annotations,
            },
          },
        },
      });
      expect(mismatched.evaluations[0]).toMatchObject({
        error: { code: 'REVIEW_OUTPUT_MISMATCH' },
        humanReview: { reviewer: 'unassigned' },
        output: initial.evaluations[0]?.output,
      });
      await expect(
        compareInference({
          ...params,
          reviews: { ...reviews, snapshotDigest: 'wrong' },
        }),
      ).rejects.toThrow(RangeError);
      await expect(
        compareInference({ ...params, modelIds: ['development:evidence-v2'] }),
      ).rejects.toThrow(RangeError);
      await writeFile(path, '{"reviews":{}}');
      await expect(readReviews(path)).rejects.toThrow();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
