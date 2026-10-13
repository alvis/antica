import { describe, expect, it, vi } from 'vitest';

import { createExaWebResearch, isPublicSourceUrl } from './web.js';

import type Exa from 'exa-js';

const provider = vi.hoisted(() => ({
  search: vi.fn<Exa['search']>(async () => ({
    requestId: 'request',
    results: [
      {
        id: 'one',
        title: 'Catalog',
        url: 'https://museum.example.org/catalog/1',
        text: '青釉 bowl',
      },
      {
        id: 'two',
        title: null,
        url: 'https://museum.example.org/catalog/2',
        text: '',
      },
      {
        id: 'private',
        title: null,
        url: 'http://127.0.0.1/private',
        text: 'private',
      },
    ],
  })),
}));
vi.mock('exa-js', () => ({
  default: class {
    public readonly search = provider.search;
  },
}));

describe('fn:isPublicSourceUrl', () => {
  it('should permit ordinary public HTTPS source locations', () => {
    expect(
      isPublicSourceUrl(
        'https://museum.example.org/catalog/item?language=zh-Hant',
      ),
    ).toBe(true);
  });

  it('should reject private addresses and non-web schemes supplied by source material', () => {
    const addresses = [
      'http://127.0.0.1/private',
      'http://169.254.169.254/latest/meta-data',
      'http://[::1]/',
      'http://[::ffff:127.0.0.1]/',
      'http://10.0.0.1/',
      'https://localhost/',
      'https://printer.local/',
      'file:///etc/passwd',
      'javascript:alert(1)',
    ];

    expect(addresses.map(isPublicSourceUrl)).toEqual(
      addresses.map(() => false),
    );
  });

  it('should reject embedded credentials and unexpected service ports', () => {
    expect([
      isPublicSourceUrl('https://collector:secret@example.org/book'),
      isPublicSourceUrl('https://museum.example.org:8443/admin'),
      isPublicSourceUrl('not a URL'),
    ]).toEqual([false, false, false]);
  });
});

describe('fn:createExaWebResearch', () => {
  it('should preserve provider failure as retryable without returning citations', async () => {
    const cause = new Error('Provider unavailable');
    provider.search.mockRejectedValueOnce(cause);
    expect(
      await createExaWebResearch({ apiKey: 'test-key' }).search('青釉'),
    ).toMatchObject({
      success: false,
      error: { code: 'PROVIDER_UNAVAILABLE', retryable: true },
      cause,
    });
    expect(provider.search.mock.calls).toHaveLength(1);
  });
  it('should reject blank research instructions before contacting the provider', async () => {
    expect(
      await createExaWebResearch({ apiKey: 'test-key' }).search(' \n '),
    ).toMatchObject({
      success: false,
      error: { code: 'VALIDATION_FAILED', retryable: false },
    });
    expect(provider.search.mock.calls).toEqual([]);
  });
  it('should retain provider excerpts only from public URLs and mark missing text for review', async () => {
    const research = createExaWebResearch({ apiKey: 'test-key' });

    const result = await research.search('青釉來源');

    expect(result).toMatchObject({
      success: true,
      data: [
        {
          relation: 'background',
          availability: 'link_only',
          verification: 'located',
          locator: {
            kind: 'web',
            url: 'https://museum.example.org/catalog/1',
            snapshotAssetId: null,
            blockId: null,
            excerptAsRetrieved: '青釉 bowl',
          },
        },
        {
          availability: 'link_only',
          verification: 'needs_review',
          locator: {
            url: 'https://museum.example.org/catalog/2',
            excerptAsRetrieved: '',
          },
        },
      ],
    });
    expect(provider.search.mock.calls).toEqual([
      [
        '青釉來源',
        {
          type: 'auto',
          numResults: 10,
          contents: { text: { maxCharacters: 12_000 } },
        },
      ],
    ]);
  });

  it('should report missing configuration without issuing a network request', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => {
      throw new Error('Network must not run without credentials');
    });
    vi.stubGlobal('fetch', fetch);
    const research = createExaWebResearch({});

    const result = await research.search('查找青釉器的來源');

    expect(result).toMatchObject({
      success: false,
      error: { code: 'PROVIDER_UNAVAILABLE' },
    });
    expect(fetch).not.toHaveBeenCalled();
  });
});
