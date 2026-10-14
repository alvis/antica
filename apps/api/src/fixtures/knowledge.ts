import { randomUUID } from 'node:crypto';

import type { KnowledgeWrite } from '@antica/contracts';

/**
 * creates a fresh draft and one inspection method for knowledge scenarios
 * @returns a valid draft input with a unique request key
 */
export function knowledgeInput(): KnowledgeWrite {
  return {
    requestKey: randomUUID(),
    status: 'draft',
    originResearchId: null,
    linkedMethodIds: [],
    content: {
      titleZhHant: '觀察釉面',
      aliases: ['釉色'],
      kinds: ['surface'],
      otherKindLabel: null,
      summary: {
        textZhHant: '等待來源核對',
        support: 'needs_source',
        citationIds: [],
      },
      history: [],
      features: [],
      applicability: [],
      exampleReferenceImageIds: [],
      relatedEntryIds: [],
      citations: [],
    },
    methodWrites: [
      {
        methodId: null,
        expectedVersionId: null,
        definition: {
          titleZhHant: '自然光觀察',
          history: [],
          featureEntryIds: [],
          applicability: [],
          observationModes: ['in_person_visual'],
          steps: [
            {
              order: 1,
              actionZhHant: '在自然光下觀察',
              evidenceToCaptureZhHant: '記錄表面',
            },
          ],
          interpretationLimits: [],
          exampleReferenceImageIds: [],
          citations: [],
        },
      },
    ],
  };
}
