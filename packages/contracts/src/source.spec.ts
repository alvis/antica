import { describe, expect, it } from 'vitest';

import { sourceLocatorSchema, sourceRegistrationSchema } from './source.js';

const id = '00000000-0000-4000-8000-000000000001';
const metadata = {
  title: 'Catalogue',
  contributors: [],
  authorStatus: 'unknown',
  editionStatement: null,
  publisher: null,
  publicationDateAsPrinted: null,
  isbn: null,
  languages: [],
  canonicalUrl: null,
  access: 'stored_copy',
  rightsStatement: null,
  attributionText: null,
};
const registration = {
  intakeKey: id,
  kind: 'book_pages',
  metadata,
  assets: [],
  existingSourceId: null,
  expectedRevision: null,
};

describe('source locator validation', () => {
  it('should require a page text range to advance beyond its start', () => {
    const locator = {
      kind: 'page',
      sourceId: id,
      sourceVersionId: id,
      pageId: id,
      pageIndex: 0,
      printedPageLabel: null,
      canonicalViewId: id,
      regionId: null,
      region: null,
      textRange: { blockId: id, start: 3, end: 4 },
    };

    expect(sourceLocatorSchema.safeParse(locator).success).toBe(true);
    expect(
      sourceLocatorSchema.safeParse({
        ...locator,
        textRange: { ...locator.textRange, end: 3 },
      }).success,
    ).toBe(false);
  });
});

describe('source registration validation', () => {
  it('should pair source revisions with existing source identities', () => {
    expect(sourceRegistrationSchema.safeParse(registration).success).toBe(true);
    expect(
      sourceRegistrationSchema.safeParse({
        ...registration,
        existingSourceId: id,
      }).success,
    ).toBe(false);
    expect(
      sourceRegistrationSchema.safeParse({
        ...registration,
        expectedRevision: 1,
      }).success,
    ).toBe(false);
    expect(
      sourceRegistrationSchema.safeParse({
        ...registration,
        existingSourceId: id,
        expectedRevision: 1,
      }).success,
    ).toBe(true);
  });

  it('should accept a page presentation and reject one on a PDF intake', () => {
    const assets = [
      {
        assetId: id,
        order: 0,
        printedPageLabel: null,
        presentation: { rotationQuarterTurns: 1, crop: null },
      },
    ];

    expect(
      sourceRegistrationSchema.safeParse({ ...registration, assets }).success,
    ).toBe(true);
    expect(
      sourceRegistrationSchema.safeParse({
        ...registration,
        kind: 'book_pdf',
        assets,
      }).success,
    ).toBe(false);
    expect(
      sourceRegistrationSchema.safeParse({
        ...registration,
        kind: 'book_pdf',
        assets: [{ assetId: id, order: 0, printedPageLabel: null }],
      }).success,
    ).toBe(true);
  });
});
