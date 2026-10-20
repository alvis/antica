import { describe, expect, it, jest } from '@jest/globals';

import { claim, image } from '../components/knowledge.spec.fixtures';

import {
  distinctCardImages,
  photoKey,
  pickCardImage,
  pickQuotedClaim,
} from './useKnowledgePreview';

jest.mock('../../../providers/AuthProvider', () => ({ useAuth: jest.fn() }));

/**
 * one rendition of the fixture photo
 * @param url where the provider serves it
 * @param status whether the reviewer kept it
 * @returns the image
 */
const rendition = (
  url: string,
  status: typeof image.status = image.status,
): typeof image => ({ ...image, imageUrl: url, status });

describe('fn:pickCardImage', () => {
  it('should skip a TIFF master the device cannot decode and prefer the screen rendition', () => {
    const master = rendition('https://museum.example/1973.84_full.tif');
    const print = rendition('https://museum.example/1973.84_print.jpg');
    const web = rendition('https://museum.example/1973.84_web.jpg');

    expect(pickCardImage([master, print, web])).toBe(web);
  });

  it('should take the first decodable image when no rendition is named', () => {
    const first = rendition('https://museum.example/front.png?size=full');
    const second = rendition('https://museum.example/side.webp');

    expect(pickCardImage([first, second])).toBe(first);
  });

  it('should show nothing rather than a removed or undecodable image', () => {
    expect(
      pickCardImage([
        rendition('https://museum.example/front_web.jpg', 'removed'),
        rendition('https://museum.example/front.tif'),
      ]),
    ).toBeUndefined();
  });

  it('should take the print rendition for a full-width card and the main view before an alternate', () => {
    const alternate = rendition(
      'https://museum.example/1957.40_alt0_print.jpg',
    );
    const web = rendition('https://museum.example/1957.40_web.jpg');
    const print = rendition('https://museum.example/1957.40_print.jpg');

    expect(pickCardImage([alternate, web, print], 'wide')).toBe(print);
    expect(pickCardImage([alternate, web, print])).toBe(web);
  });

  it('should pass over a view another card already shows', () => {
    const main = rendition('https://museum.example/1957.40_web.jpg');
    const alternate = rendition('https://museum.example/1957.40_alt0_web.jpg');

    expect(pickCardImage([main, alternate], 'card', new Set(['1957.40']))).toBe(
      alternate,
    );
  });
});

describe('fn:photoKey', () => {
  it('should give every rendition of one view the same key', () => {
    expect(
      photoKey(rendition('https://museum.example/1957.40_print.jpg')),
    ).toBe(photoKey(rendition('https://museum.example/1957.40_web.jpg')));
    expect(
      photoKey(rendition('https://images.example/web-large/DP256953.jpg')),
    ).toBe(photoKey(rendition('https://images.example/original/DP256953.jpg')));
    expect(
      photoKey(rendition('https://museum.example/1957.40_alt0_web.jpg')),
    ).not.toBe(photoKey(rendition('https://museum.example/1957.40_web.jpg')));
  });
});

describe('fn:distinctCardImages', () => {
  it('should give two entries that share a photo set different views, in card order', () => {
    const shared = [
      rendition('https://museum.example/1957.40_web.jpg'),
      rendition('https://museum.example/1957.40_alt0_web.jpg'),
    ];
    const other = [rendition('https://museum.example/DP256953_web.jpg')];

    expect(distinctCardImages([shared, other, shared, undefined])).toEqual([
      shared[0],
      other[0],
      shared[1],
      undefined,
    ]);
  });
});

describe('fn:pickQuotedClaim', () => {
  const summary = { ...claim, claimKey: 'summary' };
  const praise = {
    ...claim,
    claimKey: 'praise',
    section: 'applicability' as const,
  };
  const features = {
    ...claim,
    claimKey: 'features',
    section: 'features' as const,
  };
  const uncited = {
    ...features,
    claimKey: 'uncited-features',
    supportState: 'needs_source' as const,
    citationIds: [],
  };

  it('should quote a cited feature before the excerpt the related card chose', () => {
    expect(
      pickQuotedClaim([summary, uncited, praise, features], 'praise'),
    ).toBe(features);
  });

  it('should fall back to the excerpt, then to the first cited claim', () => {
    expect(pickQuotedClaim([summary, uncited, praise], 'praise')).toBe(praise);
    expect(pickQuotedClaim([uncited, summary, praise])).toBe(summary);
  });

  it('should quote nothing when no claim is cited', () => {
    expect(pickQuotedClaim([uncited])).toBeUndefined();
  });
});
