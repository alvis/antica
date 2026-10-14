import { z } from 'zod';

import { modelInvocationSchema } from './analysis.js';
import { imageComparisonSchema } from './knowledge.js';

/** public comparison result with the actual model invocation, when one occurred */
export const imageComparisonResultSchema = z.strictObject({
  value: imageComparisonSchema,
  invocation: modelInvocationSchema.nullable(),
});
export type ImageComparisonResult = z.infer<typeof imageComparisonResultSchema>;
