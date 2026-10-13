import { describe, expect, it } from 'vitest';

import {
  artifactKey,
  assertStorageKey,
  derivativeKey,
  originalKey,
} from './media-store.js';

const assetId = 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA';
const derivativeId = 'BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBBBBB';
const parseRunId = 'CCCCCCCC-CCCC-4CCC-8CCC-CCCCCCCCCCCC';

describe('fn:originalKey', () => {
  it('should derive a normalized original key and reject malformed asset identities', () => {
    expect(originalKey(assetId)).toBe(
      'originals/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    );
    expect(() => originalKey('missing-uuid')).toThrow();
  });
});

describe('fn:derivativeKey', () => {
  it('should preserve original provenance and reject malformed derivative identities', () => {
    expect(derivativeKey(assetId, derivativeId)).toBe(
      'derivatives/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    );
    expect(() => derivativeKey('missing-uuid', derivativeId)).toThrow();
    expect(() => derivativeKey(assetId, 'missing-uuid')).toThrow();
  });
});

describe('fn:artifactKey', () => {
  it('should bind an artifact to its source, parse run, and asset identities', () => {
    expect(artifactKey(assetId, parseRunId, derivativeId)).toBe(
      'artifacts/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/cccccccc-cccc-4ccc-8ccc-cccccccccccc/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    );
    expect(() =>
      artifactKey('missing-uuid', parseRunId, derivativeId),
    ).toThrow();
    expect(() => artifactKey(assetId, 'missing-uuid', derivativeId)).toThrow();
    expect(() => artifactKey(assetId, parseRunId, 'missing-uuid')).toThrow();
  });
});

describe('fn:assertStorageKey', () => {
  it('should accept private object keys and reject traversal or unknown prefixes', () => {
    expect(() => assertStorageKey(originalKey(assetId))).not.toThrow();
    expect(() =>
      assertStorageKey(derivativeKey(assetId, derivativeId)),
    ).not.toThrow();
    expect(() =>
      assertStorageKey(artifactKey(assetId, parseRunId, derivativeId)),
    ).not.toThrow();
    expect(() => assertStorageKey('originals/../private')).toThrow();
    expect(() => assertStorageKey('public/file')).toThrow();
  });
});
