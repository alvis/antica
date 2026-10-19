import { describe, expect, it } from 'vitest';

import { discoverImageUrls } from './images.js';

describe('fn:discoverImageUrls', () => {
  it('should discover Cleveland, Met and generic image fields without counting ordinary links', () => {
    const urls = discoverImageUrls({
      images: { web: { url: 'https://example.org/cleveland.jpg?size=1' } },
      primaryImage: 'https://example.org/met/main',
      additionalImages: ['https://example.org/met/other'],
      thumbnailUrl: 'https://example.org/thumb.png',
      article: 'https://example.org/ordinary',
      duplicate: 'https://example.org/cleveland.jpg?size=1',
    });
    expect([...urls].sort()).toEqual(
      [
        'https://example.org/cleveland.jpg?size=1',
        'https://example.org/met/main',
        'https://example.org/met/other',
        'https://example.org/thumb.png',
      ].sort(),
    );
  });

  it('should expand AIC primary and alternate image IDs against the captured IIIF service', () => {
    expect(
      [
        ...discoverImageUrls({
          metadata: {
            config: { iiif_url: 'https://www.artic.edu/iiif/2/' },
            data: {
              image_id: 'primary',
              alt_image_ids: ['alternate', null, ''],
            },
          },
        }),
      ].sort(),
    ).toEqual(
      [
        'https://www.artic.edu/iiif/2/primary',
        'https://www.artic.edu/iiif/2/alternate',
      ].sort(),
    );
  });

  it('should count IIIF image resources while excluding API manifests and service roots', () => {
    expect([
      ...discoverImageUrls({
        resource: {
          '@id': 'https://example.org/iiif/2/item/full/800,/0/default.jpg',
        },
        manifest: 'https://example.org/iiif/2/item/manifest.json',
        service: 'https://example.org/iiif/2',
        unrelated: 3,
      }),
    ]).toEqual(['https://example.org/iiif/2/item/full/800,/0/default.jpg']);
  });

  it('should ignore invalid AIC service metadata and retain an ordinary image URL', () => {
    expect([
      ...discoverImageUrls({
        config: { iiif_url: 'ftp://example.org/iiif' },
        data: { image_id: 'primary', alt_image_ids: ['alternate'] },
        thumbnailUrl: 'https://example.org/thumbnail.jpg',
      }),
    ]).toEqual(['https://example.org/thumbnail.jpg']);
    expect([
      ...discoverImageUrls({
        config: { iiif_url: 'https://example.org/iiif' },
        data: [],
      }),
    ]).toEqual([]);
  });

  it('should handle absent alternate images and non-image nested URLs', () => {
    expect([
      ...discoverImageUrls({
        config: { iiif_url: 'https://example.org/iiif' },
        data: { image_id: 'primary' },
        links: ['https://example.org/page'],
      }),
    ]).toEqual(['https://example.org/iiif/primary']);
  });

  it('should discover an image URL at the root and in a root array', () => {
    expect([...discoverImageUrls('https://example.org/root.jpg')]).toEqual([
      'https://example.org/root.jpg',
    ]);
    expect([...discoverImageUrls(['https://example.org/array.jpg'])]).toEqual([
      'https://example.org/array.jpg',
    ]);
  });

  it('should discover opaque Cleveland image URLs nested under images', () => {
    const urls = discoverImageUrls({
      images: {
        web: 'https://images.example.test/opaque-image-id',
        print: { href: 'https://cdn.example/asset/opaque' },
      },
    });
    expect([...urls].sort()).toEqual([
      'https://cdn.example/asset/opaque',
      'https://images.example.test/opaque-image-id',
    ]);
  });

  it('should exclude IIIF image metadata within an image array', () => {
    expect([
      ...discoverImageUrls({
        images: [
          {
            '@context': 'https://iiif.io/api/image/2/context.json',
            'profile': 'https://iiif.io/api/image/2/level2.json',
            'url': 'https://cdn.example/image',
          },
        ],
      }),
    ]).toEqual(['https://cdn.example/image']);
  });
});
