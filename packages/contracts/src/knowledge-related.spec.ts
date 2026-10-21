import { describe, expect, it } from 'vitest';

import { relatedKnowledgeMatchSchema } from './knowledge-related.js';

describe('related knowledge match compatibility', () => {
  it('should read legacy reasons as saved record matches', () => {
    const legacy = {
      field: 'material',
      value: 'Celadon',
      topicId: null,
      label: 'Celadon',
      matchedTokens: [],
    };

    expect(relatedKnowledgeMatchSchema.parse(legacy)).toEqual({
      ...legacy,
      source: 'record',
    });
    expect(
      relatedKnowledgeMatchSchema.parse({ ...legacy, source: 'suggestion' })
        .source,
    ).toBe('suggestion');
  });
});
