import { describe, expect, it } from 'vitest';

import { createCorpusFixture, mutateCorpusFixture } from './fixtures/corpus.js';
import { validateCorpusDocuments } from './validate.js';

import type { CorpusFile } from '@antica/contracts';

import type { CorpusDocument, CorpusValidationOptions } from './validate.js';

const entryPath = 'entries/ceramics/0.json';
const sourcePath = 'sources/alpha/ceramics-alpha.json';
const taxonomyPath = 'taxonomy.json';
const queriesPath = 'queries/owner.json';
const releasePath = 'releases/1.0.0.json';
const offsetInstant = '2026-10-18T12:00:00.000+00:00';

const offsetInstantCases: ReadonlyArray<{
  name: string;
  path: string;
  update: (file: CorpusFile) => void;
}> = [
  {
    name: 'source retrieval',
    path: sourcePath,
    update: (file) => {
      if (file.kind === 'source') {
        file.retrievedAt = offsetInstant;
      }
    },
  },
  {
    name: 'structured locator retrieval',
    path: sourcePath,
    update: (file) => {
      if (file.kind === 'source' && file.locators[0]?.kind === 'structured') {
        file.locators[0].retrievedAt = offsetInstant;
      }
    },
  },
  {
    name: 'rights observation',
    path: sourcePath,
    update: (file) => {
      if (file.kind === 'source') {
        file.rights = {
          observedAt: offsetInstant,
          evidenceUrl: 'https://example.org/rights',
          statement: 'All rights reserved',
        };
      }
    },
  },
  {
    name: 'editorial review',
    path: entryPath,
    update: (file) => {
      if (file.kind === 'entry') {
        file.editorialReview = {
          state: 'reviewed',
          actor: 'curator',
          at: offsetInstant,
        };
      }
    },
  },
  {
    name: 'translation',
    path: entryPath,
    update: (file) => {
      if (file.kind === 'entry') {
        file.claims[0]!.variants.push({
          language: 'zh-Hant',
          kind: 'translation',
          text: '已翻譯',
          method: 'human',
          sourceTextHash: file.claims[0]!.variants[0]!.sourceTextHash,
          translatedAt: offsetInstant,
          review: { state: 'pending' },
        });
      }
    },
  },
  {
    name: 'image check',
    path: sourcePath,
    update: (file) => {
      if (file.kind === 'source') {
        file.images[0]!.lastCheckedAt = offsetInstant;
      }
    },
  },
  {
    name: 'release publication',
    path: releasePath,
    update: (file) => {
      if (file.kind === 'release') {
        file.publishedAt = offsetInstant;
        file.reviewer = 'curator';
      }
    },
  },
  {
    name: 'taxonomy mapping review',
    path: taxonomyPath,
    update: (file) => {
      if (file.kind === 'taxonomy') {
        file.topics[0]!.mappings.push({
          authority: 'wikidata',
          authorityId: 'Q1',
          uri: 'https://www.wikidata.org/wiki/Q1',
          relation: 'exact',
          citationId: 'antica:citation:ceramics-alpha',
          reviewState: 'reviewed',
          reviewedBy: 'curator',
          reviewedAt: offsetInstant,
        });
      }
    },
  },
];

function expectRejected(
  documents: readonly CorpusDocument[],
  code: string,
  options?: CorpusValidationOptions,
): void {
  const result = validateCorpusDocuments(documents, options);
  const codes = result.issues.map((issue) => issue.code);
  expect(codes).toContain(code);
  expect(new Set(codes)).toEqual(new Set([code]));
  expect(
    result.issues.every(
      (issue) =>
        issue.file.length > 0 &&
        issue.path.startsWith('$') &&
        issue.message.length > 0,
    ),
  ).toBe(true);
}

function change(
  path: string,
  update: (file: CorpusFile) => void,
): CorpusDocument[] {
  return mutateCorpusFixture(createCorpusFixture(), { path, update });
}

describe('fn:validateCorpusDocuments', () => {
  it.each(offsetInstantCases)(
    'should reject a non-Z UTC offset for $name',
    ({ path, update }) => {
      expectRejected(change(path, update), 'schema');
    },
  );

  it('should accept a complete four-category release and report its inventory', () => {
    expect(
      validateCorpusDocuments(createCorpusFixture(), { release: '1.0.0' }),
    ).toEqual({
      issues: [],
      counts: {
        topics: 4,
        entries: 40,
        claims: 40,
        sources: 8,
        images: 8,
        questions: 20,
      },
    });
  });

  it('should reject a malformed JSON member', () => {
    const documents = createCorpusFixture().map((document) =>
      document.path === entryPath ? { ...document, text: '{' } : document,
    );
    expectRejected(documents, 'json');
  });

  it('should reject a strict-schema extra field', () => {
    const documents = change(entryPath, (file) => {
      if (file.kind === 'entry') {
        Object.assign(file, { invented: true });
      }
    });
    expectRejected(documents, 'schema');
  });

  it('should reject noncanonical bytes even when the parsed value is valid', () => {
    const documents = createCorpusFixture().map((document) =>
      document.path === entryPath
        ? { ...document, text: ` ${document.text}` }
        : document,
    );
    expectRejected(documents, 'canonical_bytes');
  });

  it('should reject a duplicate global content ID', () => {
    expectRejected(
      change(entryPath, (file) => {
        if (file.kind === 'entry') {
          file.id = 'antica:entry:ceramics:1';
        }
      }),
      'duplicate_id',
    );
  });

  it('should reject a missing selected release', () => {
    expectRejected(createCorpusFixture(), 'release_count', {
      release: '2.0.0',
    });
  });

  it('should reject a changed exact member byte', () => {
    const original = createCorpusFixture();
    const changed = mutateCorpusFixture(original, {
      path: entryPath,
      update: (file) => {
        if (file.kind === 'entry') {
          file.titles[0]!.text = 'Changed title';
        }
      },
    });
    const documents = changed.map((document) =>
      document.path === releasePath
        ? original.find((member) => member.path === releasePath)!
        : document,
    );
    expectRejected(documents, 'file_hash');
  });

  it('should reject a traversal path in the release', () => {
    expectRejected(
      change(releasePath, (file) => {
        if (file.kind === 'release') {
          file.files.push({ path: '../outside.json', sha256: '0'.repeat(64) });
        }
      }),
      'manifest_path',
    );
  });

  it('should reject a missing release member', () => {
    expectRejected(
      change(releasePath, (file) => {
        if (file.kind === 'release') {
          file.files.push({ path: 'missing.json', sha256: '0'.repeat(64) });
        }
      }),
      'manifest_missing',
    );
  });

  it('should reject a duplicate release path', () => {
    const documents = change(releasePath, (file) => {
      if (file.kind === 'release') {
        file.files.push({ ...file.files[0]! });
      }
    });
    expectRejected(documents, 'manifest_duplicate_path');
  });

  it('should reject a duplicate release hash', () => {
    const sameText = '# same bytes\n';
    const documents = mutateCorpusFixture(
      [
        ...createCorpusFixture(),
        { path: 'README.md', text: sameText },
        { path: 'LICENSE.md', text: sameText },
      ],
      { path: 'not-a-member', update: () => undefined },
    );
    expectRejected(documents, 'manifest_duplicate_hash');
  });

  it('should reject an incorrect self-excluding manifest hash', () => {
    const documents = createCorpusFixture().map((document) =>
      document.path === releasePath
        ? {
            ...document,
            text: document.text.replace(
              /"manifestHash":"[a-f0-9]{64}"/,
              `"manifestHash":"${'0'.repeat(64)}"`,
            ),
          }
        : document,
    );
    expectRejected(documents, 'manifest_hash');
  });

  it('should reject a published release without a reviewer', () => {
    expectRejected(
      change(releasePath, (file) => {
        if (file.kind === 'release') {
          file.publishedAt = '2026-10-18T12:00:00.000Z';
        }
      }),
      'release_review',
    );
  });

  it('should reject an extra category root', () => {
    expectRejected(
      change(taxonomyPath, (file) => {
        if (file.kind === 'taxonomy') {
          file.topics.push({
            id: 'antica:topic:extra',
            facet: 'category',
            sortOrder: 5,
            labels: [
              { language: 'en', text: 'Extra', kind: 'preferred' },
              { language: 'zh-Hant', text: '額外', kind: 'preferred' },
            ],
            relatedIds: [],
            mappings: [],
          });
        }
      }),
      'category_roots',
    );
  });

  it('should reject a missing preferred interface-language label', () => {
    expectRejected(
      change(taxonomyPath, (file) => {
        if (file.kind === 'taxonomy') {
          file.topics[0]!.labels[0]!.kind = 'alias';
        }
      }),
      'preferred_labels',
    );
  });

  it('should reject a dangling parent', () => {
    expectRejected(
      change(taxonomyPath, (file) => {
        if (file.kind === 'taxonomy') {
          file.topics.push({
            id: 'antica:topic:material-child',
            facet: 'material',
            sortOrder: 5,
            parentId: 'antica:topic:missing',
            relatedIds: [],
            mappings: [],
            labels: [
              { language: 'en', text: 'Material child', kind: 'preferred' },
              { language: 'zh-Hant', text: '材質子項', kind: 'preferred' },
            ],
          });
        }
      }),
      'parent_missing',
    );
  });

  it('should reject a parent cycle', () => {
    expectRejected(
      change(taxonomyPath, (file) => {
        if (file.kind === 'taxonomy') {
          file.topics.push({
            id: 'antica:topic:material-cycle',
            facet: 'material',
            sortOrder: 5,
            parentId: 'antica:topic:material-cycle',
            relatedIds: [],
            mappings: [],
            labels: [
              { language: 'en', text: 'Material cycle', kind: 'preferred' },
              { language: 'zh-Hant', text: '材質循環', kind: 'preferred' },
            ],
          });
        }
      }),
      'parent_cycle',
    );
  });

  it('should reject a cross-facet parent', () => {
    expectRejected(
      change(taxonomyPath, (file) => {
        if (file.kind === 'taxonomy') {
          file.topics.push({
            id: 'antica:topic:material',
            facet: 'material',
            sortOrder: 5,
            parentId: file.topics[0]!.id,
            labels: [
              { language: 'en', text: 'Material', kind: 'preferred' },
              { language: 'zh-Hant', text: '材質', kind: 'preferred' },
            ],
            relatedIds: [],
            mappings: [],
          });
        }
      }),
      'parent_facet',
    );
  });

  it('should reject an unlocated authority mapping', () => {
    expectRejected(
      change(taxonomyPath, (file) => {
        if (file.kind === 'taxonomy') {
          file.topics[0]!.mappings.push({
            authority: 'wikidata',
            authorityId: 'Q1',
            uri: 'https://www.wikidata.org/wiki/Q1',
            relation: 'exact',
            citationId: 'antica:citation:missing',
            reviewState: 'pending',
          });
        }
      }),
      'mapping_citation',
    );
  });

  it('should reject a changed captured payload hash', () => {
    const documents = mutateCorpusFixture(createCorpusFixture(), {
      path: sourcePath,
      update: (file) => {
        if (file.kind === 'source') {
          file.payloadHash = '0'.repeat(64);
          file.citations[0]!.payloadHash = file.payloadHash;
        }
      },
      rehashPayload: false,
    });
    expectRejected(documents, 'payload_hash');
  });

  it('should reject an unresolved structured pointer', () => {
    expectRejected(
      change(sourcePath, (file) => {
        if (file.kind === 'source' && file.locators[0]?.kind === 'structured') {
          file.locators.push({
            ...file.locators[0],
            id: 'antica:locator:missing-pointer',
            fieldPath: '/missing',
          });
        }
      }),
      'pointer',
    );
  });

  it('should reject a stale captured-value hash', () => {
    expectRejected(
      change(sourcePath, (file) => {
        if (file.kind === 'source' && file.locators[0]?.kind === 'structured') {
          file.locators[0].valueHash = '0'.repeat(64);
        }
      }),
      'value_hash',
    );
  });

  it('should reject a quote absent from the captured field', () => {
    expectRejected(
      change(sourcePath, (file) => {
        if (file.kind === 'source' && file.locators[0]?.kind === 'structured') {
          file.locators.push({
            ...file.locators[0],
            id: 'antica:locator:missing-excerpt',
            excerpt: 'Uncaptured words',
          });
        }
      }),
      'locator_excerpt',
    );
  });

  it('should reject a supporting citation that does not quote its locator', () => {
    expectRejected(
      change(sourcePath, (file) => {
        if (file.kind === 'source') {
          file.citations[0]!.quote = 'Uncaptured words';
        }
      }),
      'citation_quote',
    );
  });

  it('should reject a citation with the wrong source version', () => {
    expectRejected(
      change(sourcePath, (file) => {
        if (file.kind === 'source') {
          file.citations[0]!.sourceContentId =
            'museum:beta:object:ceramics-beta';
        }
      }),
      'citation_version',
    );
  });

  it('should reject an undeclared discovered image URL', () => {
    expectRejected(
      change(sourcePath, (file) => {
        if (file.kind === 'source') {
          file.images = [];
        }
      }),
      'image_urls',
    );
  });

  it('should reject an undeclared opaque Cleveland image URL', () => {
    expectRejected(
      change(sourcePath, (file) => {
        if (file.kind === 'source') {
          file.payload = {
            description: 'Captured evidence for ceramics-alpha',
            imageUrl: 'https://example.org/images/ceramics-alpha.jpg',
            images: { web: { href: 'https://cdn.example/asset/opaque' } },
          };
        }
      }),
      'image_urls',
    );
  });

  it('should reject a dangling entry topic', () => {
    expectRejected(
      change(entryPath, (file) => {
        if (file.kind === 'entry') {
          file.topics.push({
            topicId: 'antica:topic:missing',
            applicability: 'specific',
          });
        }
      }),
      'entry_topic',
    );
  });

  it('should reject a dangling entry image', () => {
    expectRejected(
      change(entryPath, (file) => {
        if (file.kind === 'entry') {
          file.imageIds.push('antica:image:missing');
        }
      }),
      'entry_image',
    );
  });

  it('should reject a dangling cited claim', () => {
    expectRejected(
      change(entryPath, (file) => {
        if (file.kind === 'entry') {
          file.claims[0]!.citationIds.push('antica:citation:missing');
        }
      }),
      'claim_citation',
    );
  });

  it('should reject a cited claim without a supporting citation', () => {
    expectRejected(
      change(entryPath, (file) => {
        if (file.kind === 'entry') {
          file.claims[0]!.citationIds = [];
        }
      }),
      'claim_support',
    );
  });

  it('should accept a claim explicitly marked needs_source', () => {
    const documents = change(entryPath, (file) => {
      if (file.kind === 'entry') {
        file.claims[0]!.supportState = 'needs_source';
        file.claims[0]!.citationIds = [];
      }
    });
    expect(validateCorpusDocuments(documents).issues).toEqual([]);
  });

  it('should reject a missing original variant', () => {
    expectRejected(
      change(entryPath, (file) => {
        if (file.kind === 'entry') {
          file.claims[0]!.variants[0]!.kind = 'translation';
        }
      }),
      'original_variant',
    );
  });

  it('should reject an original variant hash computed from edited text', () => {
    expectRejected(
      change(entryPath, (file) => {
        if (file.kind === 'entry') {
          file.claims[0]!.variants[0]!.sourceTextHash = '0'.repeat(64);
        }
      }),
      'variant_hash',
    );
  });

  it('should reject markup in a translation', () => {
    expectRejected(
      change(entryPath, (file) => {
        if (file.kind === 'entry') {
          file.claims[0]!.variants.push({
            language: 'zh-Hant',
            kind: 'translation',
            text: '<b>中文</b>',
            method: 'human',
            sourceTextHash: file.claims[0]!.variants[0]!.sourceTextHash,
            review: { state: 'pending' },
          });
        }
      }),
      'translation_markup',
    );
  });

  it.each([
    ['emphasis', '**glazed ware**'],
    ['link', '[glazed ware](https://example.org)'],
    ['inline code', '`glazed ware`'],
    ['list', '- glazed ware\n- painted surface'],
  ])('should reject %s markdown in a translation', (_kind, text) => {
    expectRejected(
      change(entryPath, (file) => {
        if (file.kind === 'entry') {
          file.claims[0]!.variants.push({
            language: 'zh-Hant',
            kind: 'translation',
            text,
            method: 'human',
            sourceTextHash: file.claims[0]!.variants[0]!.sourceTextHash,
            review: { state: 'pending' },
          });
        }
      }),
      'translation_markup',
    );
  });

  it('should reject a reviewed decision without actor and time', () => {
    expectRejected(
      change(entryPath, (file) => {
        if (file.kind === 'entry') {
          file.editorialReview = { state: 'reviewed' };
        }
      }),
      'schema',
    );
  });

  it('should reject fewer than five explanatory entries in a category', () => {
    expectRejected(
      change(entryPath, (file) => {
        if (file.kind === 'entry') {
          file.entryType = 'object_example';
        }
      }),
      'explanatory_minimum',
    );
  });

  it('should reject fewer than five object examples in a category', () => {
    expectRejected(
      change('entries/ceramics/5.json', (file) => {
        if (file.kind === 'entry') {
          file.entryType = 'concept';
        }
      }),
      'object_minimum',
    );
  });

  it('should enforce the configurable provider minimum', () => {
    expectRejected(createCorpusFixture(), 'provider_minimum', {
      minimumProviders: 3,
    });
    expect(
      validateCorpusDocuments(createCorpusFixture(), { minimumProviders: 2 })
        .issues,
    ).toEqual([]);
  });

  it('should reject a dangling owner question relevance target', () => {
    expectRejected(
      change(queriesPath, (file) => {
        if (file.kind === 'owner_queries') {
          file.questions[0]!.relevance[0]!.entryId = 'antica:entry:missing';
        }
      }),
      'query_entry',
    );
  });

  it.each([-1, 4, 1.5])(
    'should reject an out-of-range or fractional relevance grade %s',
    (grade) => {
      expectRejected(
        change(queriesPath, (file) => {
          if (file.kind === 'owner_queries') {
            file.questions[0]!.relevance[0]!.grade = grade;
          }
        }),
        'schema',
      );
    },
  );

  it('should reject a missing provisional flag', () => {
    expectRejected(
      change(queriesPath, (file) => {
        if (file.kind === 'owner_queries') {
          Reflect.deleteProperty(file, 'provisional');
        }
      }),
      'schema',
    );
  });

  it('should reject a nonboolean provisional flag', () => {
    expectRejected(
      change(queriesPath, (file) => {
        if (file.kind === 'owner_queries') {
          Object.assign(file, { provisional: 'draft' });
        }
      }),
      'schema',
    );
  });

  it('should accept nonprovisional owner questions', () => {
    const documents = change(queriesPath, (file) => {
      if (file.kind === 'owner_queries') {
        file.provisional = false;
      }
    });
    expect(validateCorpusDocuments(documents).issues).toEqual([]);
  });

  it('should reject a related topic that does not exist', () => {
    expectRejected(
      change(taxonomyPath, (file) => {
        if (file.kind === 'taxonomy') {
          file.topics[0]!.relatedIds.push('antica:topic:missing');
        }
      }),
      'related_topic',
    );
  });

  it('should reject an authority mapping without reviewed actor and time', () => {
    expectRejected(
      change(taxonomyPath, (file) => {
        if (file.kind === 'taxonomy') {
          file.topics[0]!.mappings.push({
            authority: 'wikidata',
            authorityId: 'Q1',
            uri: 'https://www.wikidata.org/wiki/Q1',
            relation: 'exact',
            citationId: 'antica:citation:ceramics-alpha',
            reviewState: 'reviewed',
          });
        }
      }),
      'mapping_review',
    );
  });

  it('should reject a structured locator naming another provider object', () => {
    expectRejected(
      change(sourcePath, (file) => {
        if (file.kind === 'source' && file.locators[0]?.kind === 'structured') {
          file.locators[0].objectId = 'other';
        }
      }),
      'locator_identity',
    );
  });

  it('should reject a citation whose locator does not belong to its source', () => {
    expectRejected(
      change(sourcePath, (file) => {
        if (file.kind === 'source') {
          file.citations.push({
            ...file.citations[0]!,
            id: 'antica:citation:wrong-locator',
            locatorId: 'antica:locator:ceramics-beta',
          });
        }
      }),
      'citation_locator',
    );
  });

  it('should reject an empty supporting quote', () => {
    expectRejected(
      change(sourcePath, (file) => {
        if (file.kind === 'source') {
          file.citations[0]!.quote = ' ';
        }
      }),
      'support_empty',
    );
  });

  it('should reject a generic web locator without a captured page', () => {
    expectRejected(
      change(sourcePath, (file) => {
        if (file.kind === 'source') {
          file.locators[0] = {
            kind: 'web',
            id: 'antica:locator:ceramics-alpha',
            url: 'https://example.org/',
            retrievedAt: '2026-10-18T12:00:00.000Z',
            section: 'Description',
            excerpt: 'Captured evidence for ceramics-alpha',
          };
        }
      }),
      'web_capture',
    );
  });

  it('should reject rights evidence whose field digest changed without blocking rights eligibility', () => {
    expectRejected(
      change(sourcePath, (file) => {
        if (file.kind === 'source') {
          file.rights = {
            observedAt: '2026-10-18T12:00:00.000Z',
            evidenceUrl: 'https://example.org/rights',
            fieldPath: '/description',
            evidenceHash: '0'.repeat(64),
            statement: 'All rights reserved',
          };
        }
      }),
      'rights_evidence',
    );
    expect(
      validateCorpusDocuments(
        change(sourcePath, (file) => {
          if (file.kind === 'source') {
            file.rights = {
              observedAt: '2026-10-18T12:00:00.000Z',
              evidenceUrl: 'https://example.org/rights',
              statement: 'All rights reserved',
            };
          }
        }),
      ).issues,
    ).toEqual([]);
  });

  it('should reject duplicate image URLs in one snapshot', () => {
    expectRejected(
      change(sourcePath, (file) => {
        if (file.kind === 'source') {
          file.images.push({
            ...file.images[0]!,
            id: 'antica:image:duplicate',
          });
        }
      }),
      'image_duplicate_url',
    );
  });

  it('should reject an image attributed to a different provider', () => {
    expectRejected(
      change(sourcePath, (file) => {
        if (file.kind === 'source') {
          file.images[0]!.provider = 'beta';
        }
      }),
      'image_attribution',
    );
  });

  it('should reject an image locator outside its snapshot', () => {
    expectRejected(
      change(sourcePath, (file) => {
        if (file.kind === 'source') {
          file.images[0]!.locatorId = 'antica:locator:missing';
        }
      }),
      'image_locator',
    );
  });

  it('should reject an entry with a missing source', () => {
    expectRejected(
      change(entryPath, (file) => {
        if (file.kind === 'entry') {
          file.externalObjectIds.push('museum:alpha:object:missing');
        }
      }),
      'entry_source',
    );
  });

  it('should reject an entry with a different category root', () => {
    expectRejected(
      change(entryPath, (file) => {
        if (file.kind === 'entry') {
          file.topics[0]!.topicId = 'antica:topic:bronzes';
        }
      }),
      'entry_category',
    );
  });

  it('should reject duplicate local claim identities', () => {
    expectRejected(
      change(entryPath, (file) => {
        if (file.kind === 'entry') {
          file.claims.push({ ...file.claims[0]! });
        }
      }),
      'duplicate_reference',
    );
  });

  it('should reject a citation outside an entry source scope', () => {
    expectRejected(
      change(entryPath, (file) => {
        if (file.kind === 'entry') {
          file.externalObjectIds = [];
        }
      }),
      'claim_source_scope',
    );
  });

  it('should reject a cited claim supported only by background material', () => {
    const withBackground = change(sourcePath, (file) => {
      if (file.kind === 'source') {
        file.citations.push({
          ...file.citations[0]!,
          id: 'antica:citation:background',
          relation: 'background',
        });
      }
    });
    const documents = mutateCorpusFixture(withBackground, {
      path: entryPath,
      update: (file) => {
        if (file.kind === 'entry') {
          file.claims[0]!.citationIds = ['antica:citation:background'];
        }
      },
    });
    expectRejected(documents, 'claim_support');
  });

  it('should reject a dangling external object in claim scope', () => {
    expectRejected(
      change(entryPath, (file) => {
        if (file.kind === 'entry') {
          file.claims[0]!.scope.externalObjectIds = [
            'museum:alpha:object:missing',
          ];
        }
      }),
      'claim_scope',
    );
  });

  it('should reject a duplicated original variant', () => {
    expectRejected(
      change(entryPath, (file) => {
        if (file.kind === 'entry') {
          file.claims[0]!.variants.push({
            ...file.claims[0]!.variants[0]!,
            language: 'zh-Hant',
          });
        }
      }),
      'original_variant',
    );
  });

  it('should reject an owner question with repeated judgments', () => {
    expectRejected(
      change(queriesPath, (file) => {
        if (file.kind === 'owner_queries') {
          file.questions[0]!.relevance.push({
            ...file.questions[0]!.relevance[0]!,
          });
        }
      }),
      'duplicate_reference',
    );
  });

  it('should accept a located reviewed mapping with actor and time', () => {
    const documents = change(taxonomyPath, (file) => {
      if (file.kind === 'taxonomy') {
        file.topics[0]!.mappings.push({
          authority: 'wikidata',
          authorityId: 'Q1',
          uri: 'https://www.wikidata.org/wiki/Q1',
          relation: 'exact',
          citationId: 'antica:citation:ceramics-alpha',
          reviewState: 'reviewed',
          reviewedBy: 'curator',
          reviewedAt: '2026-10-18T12:00:00.000Z',
        });
      }
    });
    expect(validateCorpusDocuments(documents).issues).toEqual([]);
  });

  it('should reject a self-related topic and a repeated related topic', () => {
    expectRejected(
      change(taxonomyPath, (file) => {
        if (file.kind === 'taxonomy') {
          file.topics[0]!.relatedIds = [file.topics[0]!.id];
        }
      }),
      'related_topic',
    );
    expectRejected(
      change(taxonomyPath, (file) => {
        if (file.kind === 'taxonomy') {
          file.topics[0]!.relatedIds = [file.topics[1]!.id, file.topics[1]!.id];
        }
      }),
      'related_topic',
    );
  });

  it('should accept a field-bound rights notice with its captured value hash', () => {
    const documents = change(sourcePath, (file) => {
      if (file.kind === 'source') {
        file.fieldRights.push({
          observedAt: '2026-10-18T12:00:00.000Z',
          evidenceUrl: 'https://example.org/rights',
          fieldPath: '/description',
          evidenceHash:
            file.locators[0]!.kind === 'structured'
              ? file.locators[0]!.valueHash
              : '',
          statement: 'Rights are restricted',
        });
      }
    });
    expect(validateCorpusDocuments(documents).issues).toEqual([]);
  });

  it('should accept a specific web page with a captured section and quote', () => {
    const documents = change(sourcePath, (file) => {
      if (file.kind === 'source') {
        file.locators[0] = {
          kind: 'web',
          id: 'antica:locator:ceramics-alpha',
          url: 'https://example.org/object/ceramics-alpha',
          retrievedAt: '2026-10-18T12:00:00.000Z',
          section: 'Description',
          excerpt: 'Captured evidence for ceramics-alpha',
        };
      }
    });
    expect(validateCorpusDocuments(documents).issues).toEqual([]);
  });

  it('should reject a web excerpt absent from captured payload', () => {
    expectRejected(
      change(sourcePath, (file) => {
        if (file.kind === 'source') {
          file.locators.push({
            kind: 'web',
            id: 'antica:locator:missing-web-excerpt',
            url: 'https://example.org/object/ceramics-alpha',
            retrievedAt: '2026-10-18T12:00:00.000Z',
            section: 'Description',
            excerpt: 'Uncaptured evidence',
          });
        }
      }),
      'web_capture',
    );
  });

  it('should accept an image tied to a locator in its own source', () => {
    const documents = change(sourcePath, (file) => {
      if (file.kind === 'source') {
        file.images[0]!.locatorId = file.locators[0]!.id;
      }
    });
    expect(validateCorpusDocuments(documents).issues).toEqual([]);
  });

  it('should reject an image URL declaration that points outside the captured payload', () => {
    expectRejected(
      change(sourcePath, (file) => {
        if (file.kind === 'source') {
          file.images[0]!.remoteUrl =
            'https://example.org/images/different.jpg';
        }
      }),
      'image_urls',
    );
  });

  it('should reject a cited claim with repeated citation IDs', () => {
    expectRejected(
      change(entryPath, (file) => {
        if (file.kind === 'entry') {
          file.claims[0]!.citationIds.push(file.claims[0]!.citationIds[0]!);
        }
      }),
      'duplicate_reference',
    );
  });

  it('should reject an original variant whose text differs from the claim', () => {
    expectRejected(
      change(entryPath, (file) => {
        if (file.kind === 'entry') {
          file.claims[0]!.variants[0]!.text = 'Different original text';
        }
      }),
      'original_variant',
    );
  });

  it('should accept a reviewed claim and translation with complete review provenance', () => {
    const documents = change(entryPath, (file) => {
      if (file.kind === 'entry') {
        file.editorialReview = {
          state: 'reviewed',
          actor: 'curator',
          at: '2026-10-18T12:00:00.000Z',
        };
        file.claims[0]!.review = {
          state: 'reviewed',
          actor: 'curator',
          at: '2026-10-18T12:00:00.000Z',
        };
        file.claims[0]!.variants.push({
          language: 'zh-Hant',
          kind: 'translation',
          text: '已翻譯',
          method: 'human',
          sourceTextHash: file.claims[0]!.variants[0]!.sourceTextHash,
          review: {
            state: 'reviewed',
            actor: 'curator',
            at: '2026-10-18T12:00:00.000Z',
          },
        });
      }
    });
    expect(validateCorpusDocuments(documents).issues).toEqual([]);
  });

  it('should accept a localized entry alias', () => {
    const documents = change(entryPath, (file) => {
      if (file.kind === 'entry') {
        file.aliases.push({
          language: 'en',
          text: 'Alternative name',
          kind: 'alias',
        });
      }
    });
    expect(validateCorpusDocuments(documents).issues).toEqual([]);
  });

  it('should ignore a non-JSON corpus README while validating the release', () => {
    const documents = [
      ...createCorpusFixture(),
      { path: 'README.md', text: '# Corpus\n' },
    ];
    const result = validateCorpusDocuments(documents);
    expect(result.issues.map((issue) => issue.code)).toContain(
      'manifest_coverage',
    );
  });

  it('should reject a duplicated document path and global identity', () => {
    const documents = createCorpusFixture();
    expectRejected([...documents, documents[0]!], 'duplicate_id');
  });

  it('should report a schema error at an array member path', () => {
    expectRejected(
      change(taxonomyPath, (file) => {
        if (file.kind === 'taxonomy') {
          file.topics[0]!.sortOrder = -1;
        }
      }),
      'schema',
    );
  });

  it('should reject an image from an unbound but existing source', () => {
    expectRejected(
      change(entryPath, (file) => {
        if (file.kind === 'entry') {
          file.imageIds.push('antica:image:ceramics-beta');
        }
      }),
      'entry_image',
    );
  });

  it('should accept an image rights notice without gating on its designation', () => {
    const documents = change(sourcePath, (file) => {
      if (file.kind === 'source') {
        file.images[0]!.rights = {
          observedAt: '2026-10-18T12:00:00.000Z',
          evidenceUrl: 'https://example.org/rights',
          statement: 'All rights reserved',
        };
      }
    });
    expect(validateCorpusDocuments(documents).issues).toEqual([]);
  });

  it('should enforce provider and entry minima when a category has no entries', () => {
    const remaining = createCorpusFixture().filter(
      (document) => !document.path.startsWith('entries/ceramics/'),
    );
    const documents = mutateCorpusFixture(remaining, {
      path: entryPath,
      update: () => undefined,
    });
    const codes = validateCorpusDocuments(documents).issues.map(
      (issue) => issue.code,
    );
    expect(codes).toEqual(
      expect.arrayContaining([
        'explanatory_minimum',
        'object_minimum',
        'provider_minimum',
      ]),
    );
  });
});
