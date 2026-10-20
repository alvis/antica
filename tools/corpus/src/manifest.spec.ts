import { describe, expect, it } from 'vitest';

import { createGuideCorpusFixture } from './fixtures/guides.js';
import { selectCorpusReleaseVersion } from './release-selection.js';
import { validateCorpusDocuments } from './validate.js';

describe('fn:selectCorpusReleaseVersion', () => {
  it.each([
    [['1.9.9', '1.10.0', '1.2.99'], '1.10.0'],
    [['1.0.9', '1.0.10', '1.0.2'], '1.0.10'],
    [['2.99.99', '10.0.0', '9.0.0'], '10.0.0'],
    [[], undefined],
  ] as const)(
    'should select the latest numeric semantic version from %j',
    (versions, expected) => {
      expect(selectCorpusReleaseVersion(versions)).toBe(expected);
    },
  );

  it('should preserve an explicit historical version selector', () => {
    expect(selectCorpusReleaseVersion(['1.0.0', '1.1.0'], '1.0.0')).toBe(
      '1.0.0',
    );
  });
});

describe('fn:validateCorpusDocuments', () => {
  it('should validate latest membership by default when historical manifests coexist', () => {
    expect(validateCorpusDocuments(createGuideCorpusFixture()).issues).toEqual(
      [],
    );
  });

  it('should isolate historical validation from later malformed guide bytes', () => {
    const documents = createGuideCorpusFixture().map((document) =>
      document.path === 'guides/foot.json'
        ? { ...document, text: '{' }
        : document,
    );

    expect(
      validateCorpusDocuments(documents, { release: '1.0.0' }).issues,
    ).toEqual([]);
    expect(validateCorpusDocuments(documents).issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ file: 'guides/foot.json', code: 'json' }),
      ]),
    );
  });

  it('should still diagnose unlisted files during default validation', () => {
    const documents = [
      ...createGuideCorpusFixture(),
      { path: 'unpublished.txt', text: 'Unreleased research notes' },
    ];

    expect(validateCorpusDocuments(documents).issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'manifest_coverage' }),
      ]),
    );
  });

  it('should reject missing or changed members of an explicitly selected release', () => {
    const documents = createGuideCorpusFixture();
    const missing = documents.filter(
      (document) => document.path !== 'entries/ceramics/0.json',
    );
    const changed = documents.map((document) =>
      document.path === 'entries/ceramics/0.json'
        ? {
            ...document,
            text: document.text.replace('ceramics 0', 'changed title'),
          }
        : document,
    );

    expect(
      validateCorpusDocuments(missing, { release: '1.0.0' }).issues,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'manifest_missing' }),
      ]),
    );
    expect(
      validateCorpusDocuments(changed, { release: '1.0.0' }).issues,
    ).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'file_hash' })]),
    );
  });
});
