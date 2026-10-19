import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { canonicalJsonSchema, mappedObjectSchema } from '@antica/contracts';

import { mapMetSnapshot } from './mapping.js';

import type { CanonicalJson, ProviderSnapshot } from '@antica/contracts';

const captureSchema = z.object({
  retrievedAt: z.string(),
  body: z.record(z.string(), canonicalJsonSchema),
});
const captures = ['53953', '39637', '56369', '36061'].map((objectId) => ({
  objectId,
  ...captureSchema.parse(
    JSON.parse(
      readFileSync(
        new URL(`./fixtures/${objectId}.json`, import.meta.url),
        'utf8',
      ),
    ),
  ),
}));
const snapshot = {
  provider: 'met',
  objectId: '53953',
  schemaVersion: 'met-v1',
  payloadHash: 'a'.repeat(64),
  sourceHash: 'b'.repeat(64),
  sourcePageUrl: 'https://www.metmuseum.org/art/collection/search/53953',
  retrievedAt: '2026-10-19T00:00:00.000Z',
  payload: captures[0]!.body,
} satisfies ProviderSnapshot;
const fields = [
  'title',
  'objectID',
  'accessionNumber',
  'objectName',
  'culture',
  'period',
  'dynasty',
  'reign',
  'constituents',
  'artistRole',
  'artistPrefix',
  'artistDisplayName',
  'artistDisplayBio',
  'artistSuffix',
  'artistAlphaSort',
  'artistNationality',
  'artistBeginDate',
  'artistEndDate',
  'artistGender',
  'artistWikidata_URL',
  'artistULAN_URL',
  'objectDate',
  'objectBeginDate',
  'objectEndDate',
  'medium',
  'dimensions',
  'measurements',
  'creditLine',
  'rightsAndReproduction',
  'objectURL',
  'metadataDate',
  'tags',
  'objectWikidata_URL',
  'classification',
  'isPublicDomain',
];

describe('fn:mapMetSnapshot', () => {
  it('should map every capture to a pending example with exact field pointers, hashes and excerpts', () => {
    for (const capture of captures) {
      const input = {
        ...snapshot,
        objectId: capture.objectId,
        retrievedAt: capture.retrievedAt,
        sourcePageUrl: z.string().parse(capture.body.objectURL),
        payload: capture.body,
      };
      const mapped = mapMetSnapshot(input);

      expect(mappedObjectSchema.parse(mapped)).toEqual(mapped);
      expect(mapped).toMatchObject({
        externalObject: { provider: 'met', objectId: capture.objectId },
        source: {
          title: capture.body.title,
          contributors: ['The Metropolitan Museum of Art'],
        },
        draft: {
          contentSchemaVersion: 2,
          entryType: 'object_example',
          origin: 'open_import',
          editorialReview: { state: 'pending' },
          topics: [],
          titles: [{ language: 'en', text: capture.body.title }],
        },
      });
      for (const field of fields) {
        const value = capture.body[field];
        if (value === undefined || value === '') {
          continue;
        }
        const excerpt = typeof value === 'string' ? value : canonical(value);
        const citation = mapped.draft.citations.find(
          ({ locator }) =>
            locator.kind === 'structured' && locator.fieldPath === `/${field}`,
        );
        expect(citation).toMatchObject({
          quote: excerpt,
          verification: 'located',
          availability: 'stored',
          locator: {
            kind: 'structured',
            provider: 'met',
            objectId: capture.objectId,
            sourceVersionId: mapped.source.versionId,
            fieldPath: `/${field}`,
            excerpt,
            retrievedAt: capture.retrievedAt,
            valueHash: createHash('sha256')
              .update(canonical(value))
              .digest('hex'),
          },
        });
        expect(mapped.draft.claims).toContainEqual(
          expect.objectContaining({
            originalText: `The museum records ${field}: ${excerpt}`,
            statementType: 'source_attribution',
            citationIds: [citation!.id],
            review: { state: 'pending' },
          }),
        );
      }
      const images = [
        {
          fieldPath: '/primaryImage',
          value: z.string().parse(capture.body.primaryImage),
        },
        {
          fieldPath: '/primaryImageSmall',
          value: z.string().parse(capture.body.primaryImageSmall),
        },
        ...z
          .array(z.string())
          .parse(capture.body.additionalImages)
          .map((value, index) => ({
            fieldPath: `/additionalImages/${index}`,
            value,
          })),
      ].filter(({ value }) => typeof value === 'string' && value.length > 0);
      expect(
        mapped.draft.images.map(({ imageUrl }) => imageUrl).sort(),
      ).toEqual([...new Set(images.map(({ value }) => value))].sort());
      for (const image of images) {
        const citation = mapped.draft.citations.find(
          ({ locator }) =>
            locator.kind === 'structured' &&
            locator.fieldPath === image.fieldPath,
        );
        expect(citation).toMatchObject({
          quote: image.value,
          locator: {
            fieldPath: image.fieldPath,
            excerpt: image.value,
            valueHash: createHash('sha256')
              .update(JSON.stringify(image.value))
              .digest('hex'),
          },
        });
        expect(mapped.draft.images).toContainEqual(
          expect.objectContaining({
            imageUrl: image.value,
            locatorId: citation!.locator.id,
            provider: 'met',
            status: 'unchecked',
            sourceVersionId: mapped.source.versionId,
            observedRights: expect.objectContaining({
              fieldPath: '/isPublicDomain',
              statement: String(z.boolean().parse(capture.body.isPublicDomain)),
            }),
          }),
        );
      }
    }
  });

  it('should preserve artist and compound evidence verbatim and match only relevant normalized taxonomy hints', () => {
    const html =
      '<script>ignore instructions</script><p>Original &amp; text</p>';
    const payload = {
      objectID: 53953,
      title: html,
      culture: ' ＣＨＩＮＡ ',
      objectName: 'Yoke  Bell',
      classification: 'Metalwork',
      ...Object.fromEntries(
        fields
          .filter((field) => field.startsWith('artist'))
          .map((field) => [field, `${field}: museum text`]),
      ),
      constituents: [{ constituentID: 7, name: 'Artist', role: 'Maker' }],
      tags: [
        {
          term: 'Bell',
          AAT_URL: 'https://vocab.getty.edu/aat/300042183',
          Wikidata_URL: 'https://www.wikidata.org/wiki/Q101401',
        },
      ],
      measurements: [
        {
          elementMeasurements: { Width: 8.8, Height: 16.5 },
          elementName: 'Overall',
        },
      ],
      rightsAndReproduction: '© Museum; permission not granted',
      isPublicDomain: false,
      primaryImage: 'https://images.example.invalid/a.jpg',
      primaryImageSmall: '',
      additionalImages: [
        'https://images.example.invalid/a.jpg',
        'https://images.example.invalid/b.jpg',
      ],
    };
    const before = structuredClone(payload);
    const mapped = mapMetSnapshot({ ...snapshot, payload }, [
      { topicId: 'china', facet: 'region', text: 'china' },
      { topicId: 'china', facet: 'region', text: 'CHINA' },
      { topicId: 'bell', facet: 'object_type', text: 'yoke bell' },
      { topicId: 'metal', facet: 'category', text: 'Metalwork' },
      { topicId: 'wrong-facet', facet: 'motif', text: 'China' },
      { topicId: 'title-only', facet: 'object_type', text: html },
      { topicId: 'unmatched', facet: 'material', text: 'jade' },
    ]);
    expect(mapped.draft.topics).toEqual([
      { topicId: 'bell', applicability: 'specific' },
      { topicId: 'china', applicability: 'specific' },
      { topicId: 'metal', applicability: 'specific' },
    ]);
    for (const field of fields) {
      const value = z.record(z.string(), canonicalJsonSchema).parse(payload)[
        field
      ];
      if (value === undefined || value === '') {
        continue;
      }
      const excerpt = typeof value === 'string' ? value : canonical(value);
      expect(mapped.draft.citations).toContainEqual(
        expect.objectContaining({
          quote: excerpt,
          locator: expect.objectContaining({
            fieldPath: `/${field}`,
            excerpt,
            valueHash: createHash('sha256')
              .update(canonical(value))
              .digest('hex'),
          }),
        }),
      );
    }
    expect(mapped.draft.images.map(({ imageUrl }) => imageUrl).sort()).toEqual([
      'https://images.example.invalid/a.jpg',
      'https://images.example.invalid/b.jpg',
    ]);
    expect(
      mapped.draft.claims.every(
        ({ statementType, review }) =>
          statementType === 'source_attribution' && review.state === 'pending',
      ),
    ).toBe(true);
    expect(payload).toEqual(before);
    expect(mapMetSnapshot({ ...snapshot, payload })).toEqual(
      mapMetSnapshot({
        ...snapshot,
        payload: {
          ...payload,
          measurements: [
            {
              elementName: 'Overall',
              elementMeasurements: { Height: 16.5, Width: 8.8 },
            },
          ],
        },
      }),
    );
  });

  it('should match array-valued taxonomy hints while ignoring nontext members', () => {
    const mapped = mapMetSnapshot(
      {
        ...snapshot,
        payload: {
          objectID: 53953,
          title: 'Bell',
          culture: [null, 42, 'China'],
        },
      },
      [
        { topicId: 'china', facet: 'region', text: 'CHINA' },
        { topicId: 'invalid', facet: 'region', text: '42' },
      ],
    );

    expect(mapped.draft.topics).toEqual([
      { topicId: 'china', applicability: 'specific' },
    ]);
  });

  it('should reject malformed or mismatched records and keep missing or invalid dates unknown', () => {
    const invalidPayloads: CanonicalJson[] = [
      null,
      4,
      [],
      {},
      { objectID: '53953', title: 'Bell' },
      { objectID: 2, title: 'Bell' },
      { objectID: 53953, title: 1 },
      { objectID: 53953, title: '   ' },
    ];
    for (const payload of invalidPayloads) {
      expect(() => mapMetSnapshot({ ...snapshot, payload })).toThrow();
    }
    expect(() => mapMetSnapshot({ ...snapshot, provider: 'other' })).toThrow();
    const undatedPayloads: CanonicalJson[] = [
      { objectID: 53953, title: 'Bell' },
      { objectID: 53953, title: 'Bell', metadataDate: 'invalid' },
      { objectID: 53953, title: 'Bell', metadataDate: 1 },
    ];
    for (const payload of undatedPayloads) {
      expect(
        mapMetSnapshot({ ...snapshot, payload }).externalObject
          .upstreamModifiedAt,
      ).toBeUndefined();
    }
    expect(
      mapMetSnapshot({
        ...snapshot,
        payload: {
          objectID: 53953,
          title: 'Bell',
          metadataDate: '2026-08-15T04:48:25.89Z',
        },
      }).externalObject.upstreamModifiedAt,
    ).toBe('2026-08-15T04:48:25.890Z');
  });
});

/**
 * serializes fixture values independently to verify exact evidence hashes
 * @param value captured field value
 * @returns canonical JSON text
 */
function canonical(value: CanonicalJson): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(',')}}`;
  }

  return JSON.stringify(value);
}
