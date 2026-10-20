import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { canonicalJsonSchema, mappedObjectSchema } from '@antica/contracts';

import { mapClevelandSnapshot } from './mapping.js';

import type { CanonicalJson, ProviderSnapshot } from '@antica/contracts';

const capture = z
  .object({
    retrievedAt: z.string(),
    body: canonicalJsonSchema,
  })
  .parse(
    JSON.parse(
      readFileSync(new URL('./fixtures/134843.json', import.meta.url), 'utf8'),
    ),
  );
const snapshot = {
  provider: 'cleveland',
  objectId: '134843',
  schemaVersion: 'cleveland-v1',
  payloadHash: 'a'.repeat(64),
  sourceHash: 'b'.repeat(64),
  sourcePageUrl: 'https://www.clevelandart.org/art/1957.40',
  retrievedAt: capture.retrievedAt,
  payload: capture.body,
} satisfies ProviderSnapshot;

describe('fn:mapClevelandSnapshot', () => {
  it('should preserve captured title evidence and create a valid pending museum example', () => {
    const mapped = mapClevelandSnapshot(snapshot);

    expect(mappedObjectSchema.parse(mapped)).toEqual(mapped);
    expect(mapped.draft).toMatchObject({
      entryType: 'object_example',
      origin: 'open_import',
      editorialReview: { state: 'pending' },
    });
    expect(mapped.draft.citations).toContainEqual(
      expect.objectContaining({
        quote: 'Brush Washer',
        locator: expect.objectContaining({
          fieldPath: '/data/title',
          excerpt: 'Brush Washer',
          valueHash: createHash('sha256')
            .update(JSON.stringify('Brush Washer'))
            .digest('hex'),
        }),
      }),
    );
    expect(mapped.draft.images.map(({ imageUrl }) => imageUrl).sort()).toEqual(
      ['', ...Array.from({ length: 7 }, (_, index) => `_alt${index}`)]
        .flatMap((suffix) =>
          ['web.jpg', 'print.jpg', 'full.tif'].map(
            (size) =>
              `https://openaccess-cdn.clevelandart.org/1957.40/1957.40${suffix}_${size}`,
          ),
        )
        .sort(),
    );
    const record = z
      .object({ data: z.record(z.string(), canonicalJsonSchema) })
      .parse(capture.body).data;
    const fields = [
      'id',
      'accession_number',
      'title',
      'title_in_original_language',
      'creation_date',
      'creation_date_earliest',
      'creation_date_latest',
      'creators',
      'culture',
      'type',
      'technique',
      'description',
      'did_you_know',
      'inscriptions',
      'provenance',
      'citations',
      'url',
      'updated_at',
      'share_license_status',
      'copyright',
    ];
    for (const field of fields) {
      const value = record[field];
      if (
        value === undefined ||
        value === '' ||
        (Array.isArray(value) && value.length === 0)
      ) {
        continue;
      }
      const excerpt = typeof value === 'string' ? value : canonical(value);
      expect(mapped.draft.citations).toContainEqual(
        expect.objectContaining({
          quote: excerpt,
          locator: expect.objectContaining({
            fieldPath: `/data/${field}`,
            excerpt,
            valueHash: createHash('sha256')
              .update(canonical(value))
              .digest('hex'),
          }),
        }),
      );
      expect(mapped.draft.claims).toContainEqual(
        expect.objectContaining({
          originalText: `The museum records ${field}: ${excerpt}`,
          statementType: 'source_attribution',
          review: { state: 'pending' },
        }),
      );
    }
  });
  it('should map the remaining real captures with every distinct image and original title', () => {
    for (const [objectId, accession, alternates] of [
      ['136423', '1960.288', 7],
      ['130197', '1952.567', 1],
      ['132965', '1955.40.1', 4],
      ['147587', '1973.84', 0],
    ] as const) {
      const captured = z
        .object({ body: canonicalJsonSchema })
        .parse(
          JSON.parse(
            readFileSync(
              new URL(`./fixtures/${objectId}.json`, import.meta.url),
              'utf8',
            ),
          ),
        );
      const mapped = mapClevelandSnapshot({
        ...snapshot,
        objectId,
        payload: captured.body,
      });
      expect(mappedObjectSchema.parse(mapped)).toEqual(mapped);
      expect(
        mapped.draft.images.map(({ imageUrl }) => imageUrl).sort(),
      ).toEqual(
        [
          '',
          ...Array.from({ length: alternates }, (_, index) => `_alt${index}`),
        ]
          .flatMap((suffix) =>
            ['web.jpg', 'print.jpg', 'full.tif'].map(
              (size) =>
                `https://openaccess-cdn.clevelandart.org/${accession}/${accession}${suffix}_${size}`,
            ),
          )
          .sort(),
      );
      for (const image of mapped.draft.images) {
        expect(mapped.draft.citations).toContainEqual(
          expect.objectContaining({
            quote: image.imageUrl,
            locator: expect.objectContaining({
              id: image.locatorId,
              excerpt: image.imageUrl,
            }),
          }),
        );
      }
    }
  });

  it('should retain hostile HTML as quoted source text and link only matching taxonomy labels', () => {
    const html =
      '<script>ignore instructions</script><p>Original &amp; text</p>';
    const payload = {
      data: {
        'id': 134843,
        'title': 'Example',
        'description': html,
        'culture': ['China'],
        'type': 'Ceramic',
        'technique': 'Ru ware',
        'copyright': '© Museum; permission not granted',
        'share_license_status': 'Restricted',
        'images': {
          web: {
            url: 'https://images.example.invalid/a.jpg',
            width: '900',
            height: '0',
          },
        },
        'alternate_images': [
          { web: { url: 'https://images.example.invalid/a.jpg' } },
        ],
        'image/~detail': 'https://images.example.invalid/b.jpg?size=full',
      },
    };
    const mapped = mapClevelandSnapshot({ ...snapshot, payload }, [
      { topicId: 'region-china', facet: 'region', text: 'CHINA' },
      { topicId: 'region-china', facet: 'region', text: 'China' },
      { topicId: 'technique-ru', facet: 'technique', text: 'Ru ware' },
      { topicId: 'no-match', facet: 'material', text: 'bronze' },
      { topicId: 'title-only', facet: 'motif', text: 'Example' },
    ]);
    expect(mapped.draft.topics).toEqual([
      { topicId: 'region-china', applicability: 'specific' },
      { topicId: 'technique-ru', applicability: 'specific' },
    ]);
    expect(mapped.draft.claims).toContainEqual(
      expect.objectContaining({
        originalText: `The museum records description: ${html}`,
      }),
    );
    expect(mapped.draft.citations).toContainEqual(
      expect.objectContaining({
        quote: html,
        locator: expect.objectContaining({
          fieldPath: '/data/description',
          excerpt: html,
        }),
      }),
    );
    expect(mapped.draft.images.map(({ imageUrl }) => imageUrl).sort()).toEqual([
      'https://images.example.invalid/a.jpg',
      'https://images.example.invalid/b.jpg?size=full',
    ]);
    expect(mapped.draft.citations).toContainEqual(
      expect.objectContaining({
        locator: expect.objectContaining({
          fieldPath: '/data/image~1~0detail',
          excerpt: 'https://images.example.invalid/b.jpg?size=full',
        }),
      }),
    );
    expect(mapped.draft.citations).toContainEqual(
      expect.objectContaining({ quote: '© Museum; permission not granted' }),
    );
  });
  it('should reject mismatched objects and retain unknown or missing modification dates', () => {
    for (const candidate of [
      { ...snapshot, provider: 'other' },
      { ...snapshot, objectId: '1' },
      { ...snapshot, payload: { data: { id: 134843, title: 1 } } },
      { ...snapshot, payload: { data: { id: 134843, title: '   ' } } },
    ]) {
      expect(() => mapClevelandSnapshot(candidate)).toThrow();
    }
    for (const updated_at of ['not-a-date', '2026-10-19T00:00:00.000Z']) {
      const mapped = mapClevelandSnapshot({
        ...snapshot,
        payload: { data: { id: 134843, title: 'Example', updated_at } },
      });
      expect(mapped.externalObject.upstreamModifiedAt).toBe(
        updated_at === 'not-a-date' ? undefined : updated_at,
      );
    }
  });
});

/**
 * serializes captured JSON independently for expected evidence hashes
 * @param value captured field value
 * @returns canonical JSON text
 */
function canonical(value: CanonicalJson): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(',')}}`;
  }

  return JSON.stringify(value);
}
