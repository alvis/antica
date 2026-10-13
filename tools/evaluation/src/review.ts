import { z } from 'zod';

import { readFile } from 'node:fs/promises';

const verdictSchema = z.enum(['pending', 'pass', 'fail', 'not-applicable']);
const humanReviewSchema = z.strictObject({
  reviewer: z.string().min(1),
  notes: z.string(),
  unsupportedClaims: verdictSchema,
  uncertaintyHandling: verdictSchema,
  sourceDisagreement: verdictSchema,
  traditionalChinese: verdictSchema,
  nextActionUsefulness: verdictSchema,
});
const reviewFileSchema = z.strictObject({
  snapshotDigest: z.string().regex(/^[a-f0-9]{64}$/),
  reviews: z.record(
    z.string(),
    z.strictObject({
      outputDigest: z.string().regex(/^[a-f0-9]{64}$/),
      annotations: humanReviewSchema,
    }),
  ),
});

/** describes human judgments without assigning an automated quality score */
export type HumanReview = z.infer<typeof humanReviewSchema>;

/** binds externally authored review annotations to the exact comparison snapshot */
export type EvaluationReviews = z.infer<typeof reviewFileSchema>;

/**
 * reads explicit reviewer annotations for a snapshot and model selection
 * @param path human-authored review JSON file
 * @returns validated annotations, with snapshot identity checked by the comparison
 */
export async function readReviews(path: string): Promise<EvaluationReviews> {
  return reviewFileSchema.parse(JSON.parse(await readFile(path, 'utf8')));
}
