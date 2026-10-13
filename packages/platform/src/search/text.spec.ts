import { describe, expect, it, vi } from 'vitest';

import { createLocalTextRetrieval, developmentTextIndex } from './text.js';

import type { TextSearchEntry } from './text.js';

const entry: TextSearchEntry = {
  summary: {
    id: 'knowledge-a',
    displayCode: 'K1',
    revision: 1,
    titleZhHant: '青釉',
    kinds: [],
    status: 'saved',
    summaryZhHant: '來源',
    citationCount: 1,
  },
  citation: {
    id: 'citation-a',
    relation: 'supports',
    availability: 'link_only',
    verification: 'located',
    locator: {
      kind: 'web',
      sourceId: 'source-a',
      sourceVersionId: 'version-a',
      url: 'https://museum.example.org/catalog',
      retrievedAt: '2026-10-13T00:00:00.000Z',
      snapshotAssetId: null,
      blockId: null,
      excerptAsRetrieved: '青釉 bowl',
    },
  },
  contentAsRetrieved: '青釉 bowl',
  sourceRegionId: null,
};

describe('fn:createLocalTextRetrieval', () => {
  it('should apply supported kinds, status, and source filters even when the query contains no tokens', async () => {
    const selected: TextSearchEntry = {
      ...entry,
      summary: { ...entry.summary, kinds: ['material'] },
    };
    const adapter = createLocalTextRetrieval({
      index: developmentTextIndex,
      readEntries: async () => [selected],
    });
    expect(
      await adapter.search(
        {
          q: '!!!',
          kinds: ['material'],
          status: 'saved',
          filters: { sourceIds: ['source-a'] },
        },
        developmentTextIndex,
      ),
    ).toEqual({
      success: true,
      data: { items: [selected.summary], nextCursor: null },
    });
    expect(
      await adapter.search({ kinds: ['condition'] }, developmentTextIndex),
    ).toEqual({ success: true, data: { items: [], nextCursor: null } });
    expect(
      await adapter.search(
        { filters: { sourceIds: ['other-source'] } },
        developmentTextIndex,
      ),
    ).toEqual({ success: true, data: { items: [], nextCursor: null } });
  });
  it('should reject malformed and invalid pagination offsets without reading evidence', async () => {
    const readEntries = vi.fn(async () => [
      entry,
      { ...entry, summary: { ...entry.summary, id: 'second' } },
    ]);
    const adapter = createLocalTextRetrieval({
      index: developmentTextIndex,
      readEntries,
    });
    const first = await adapter.search({ limit: 1 }, developmentTextIndex);
    if (!first.success || !first.data.nextCursor) {
      throw new Error('Expected cursor');
    }
    const decoded: { fingerprint: string } = JSON.parse(
      Buffer.from(first.data.nextCursor, 'base64url').toString(),
    );
    const cursors = [
      'not-json',
      ...[
        null,
        1,
        {},
        { fingerprint: 'other' },
        { fingerprint: decoded.fingerprint },
        { ...decoded, offset: '1' },
        { ...decoded, offset: 0.5 },
        { ...decoded, offset: -1 },
      ].map((value) =>
        Buffer.from(JSON.stringify(value)).toString('base64url'),
      ),
    ];
    for (const cursor of cursors) {
      expect(
        await adapter.search({ limit: 1, cursor }, developmentTextIndex),
      ).toMatchObject({
        success: false,
        error: { code: 'VALIDATION_FAILED', retryable: false },
      });
    }
    expect(readEntries.mock.calls).toHaveLength(1);
  });
  it('should report stored reader failures as retryable for search and evidence snapshots', async () => {
    const cause = new Error('Storage unavailable');
    const adapter = createLocalTextRetrieval({
      index: developmentTextIndex,
      readEntries: async () => {
        throw cause;
      },
    });
    expect(await adapter.search({}, developmentTextIndex)).toMatchObject({
      success: false,
      error: { code: 'SOURCE_UNAVAILABLE', retryable: true },
      cause,
    });
    expect(await adapter.snapshot('青', developmentTextIndex)).toMatchObject({
      success: false,
      error: { code: 'SOURCE_UNAVAILABLE', retryable: true },
      cause,
    });
  });
  it('should reject incompatible indexes and unsupported classifications before reading stored evidence', async () => {
    const readEntries = vi.fn(async () => [entry]);
    const adapter = createLocalTextRetrieval({
      index: developmentTextIndex,
      readEntries,
    });
    const foreign = { ...developmentTextIndex, indexVersion: 'foreign' };
    for (const result of [
      await adapter.search({}, foreign),
      await adapter.snapshot('青', foreign),
      await createLocalTextRetrieval({ index: foreign, readEntries }).search(
        {},
        foreign,
      ),
      await createLocalTextRetrieval({ index: foreign, readEntries }).snapshot(
        '青',
        foreign,
      ),
    ]) {
      expect(result).toMatchObject({
        success: false,
        error: { code: 'INDEX_NOT_READY', retryable: false },
      });
    }
    expect(
      await adapter.search(
        { filters: { materialIds: ['clay'] } },
        developmentTextIndex,
      ),
    ).toMatchObject({
      success: false,
      error: { code: 'VALIDATION_FAILED', retryable: false },
    });
    expect(readEntries.mock.calls).toEqual([]);
  });
  it('should rank retained text, deduplicate knowledge, and bind pagination to the query', async () => {
    const second: TextSearchEntry = {
      ...entry,
      summary: { ...entry.summary, id: 'knowledge-b', titleZhHant: '白瓷' },
      contentAsRetrieved: 'bowl',
    };
    const adapter = createLocalTextRetrieval({
      index: developmentTextIndex,
      readEntries: async () => [
        second,
        entry,
        entry,
        {
          ...entry,
          summary: { ...entry.summary, id: 'unavailable' },
          citation: { ...entry.citation, availability: 'unavailable' },
        },
      ],
    });
    const first = await adapter.search(
      { q: '青 bowl', limit: 1 },
      developmentTextIndex,
    );
    if (!first.success || !first.data.nextCursor) {
      throw new Error('Expected pagination');
    }
    expect(first.data.items).toEqual([entry.summary]);
    expect(
      await adapter.search(
        { q: '青 bowl', limit: 1, cursor: first.data.nextCursor },
        developmentTextIndex,
      ),
    ).toEqual({
      success: true,
      data: { items: [second.summary], nextCursor: null },
    });
    expect(
      await adapter.search(
        { q: 'changed', limit: 1, cursor: first.data.nextCursor },
        developmentTextIndex,
      ),
    ).toMatchObject({
      success: false,
      error: { code: 'VALIDATION_FAILED', retryable: false },
    });
    expect(await adapter.snapshot('青', developmentTextIndex)).toMatchObject({
      success: true,
      data: {
        citations: [entry.citation, entry.citation],
        text: [
          {
            citationId: entry.citation.id,
            contentAsRetrieved: entry.contentAsRetrieved,
            sourceRegionId: null,
          },
          {
            citationId: entry.citation.id,
            contentAsRetrieved: entry.contentAsRetrieved,
            sourceRegionId: null,
          },
        ],
      },
    });
  });
});
