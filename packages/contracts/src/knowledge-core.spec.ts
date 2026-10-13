import { describe, expect, it } from 'vitest';

import { citedTextSchema, methodWriteSchema } from './knowledge-core.js';

const id = '00000000-0000-4000-8000-000000000001';
const definition = {
  titleZhHant: 'Inspect surface',
  history: [],
  featureEntryIds: [],
  applicability: [],
  observationModes: [],
  steps: [],
  interpretationLimits: [],
  exampleReferenceImageIds: [],
  citations: [],
};

describe('cited knowledge text validation', () => {
  it('should require a locator when a statement claims citation support', () => {
    const text = {
      textZhHant: 'A statement',
      support: 'cited',
      citationIds: [],
    };

    expect(citedTextSchema.safeParse(text).success).toBe(false);
    expect(
      citedTextSchema.safeParse({ ...text, citationIds: [id] }).success,
    ).toBe(true);
    expect(
      citedTextSchema.safeParse({ ...text, support: 'needs_source' }).success,
    ).toBe(true);
  });
});

describe('inspection method write validation', () => {
  it('should tie a method version to the method being updated', () => {
    const method = { methodId: null, expectedVersionId: null, definition };

    expect(methodWriteSchema.safeParse(method).success).toBe(true);
    expect(
      methodWriteSchema.safeParse({ ...method, methodId: id }).success,
    ).toBe(false);
    expect(
      methodWriteSchema.safeParse({ ...method, expectedVersionId: id }).success,
    ).toBe(false);
    expect(
      methodWriteSchema.safeParse({
        ...method,
        methodId: id,
        expectedVersionId: id,
      }).success,
    ).toBe(true);
  });
});
