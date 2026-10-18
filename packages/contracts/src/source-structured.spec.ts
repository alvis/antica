import { describe, expect, it } from 'vitest';

import { structuredSourceSnapshotSchema } from './source.js';

const snapshot = {
  provider: 'museum',
  objectId: 'object-1',
  payloadHash: 'a'.repeat(64),
  schemaVersion: '1',
  sourceHash: 'b'.repeat(64),
  sourcePageUrl: 'https://museum.example/object/1',
  retrievedAt: '2026-10-19T00:00:00.000Z',
  payload: { title: 'Vase', imageUrl: 'https://museum.example/image.jpg' },
};

describe('fn:structuredSourceSnapshotSchema', () => {
  it('should retain canonical metadata and image URLs without guessing rights', () => {
    expect(structuredSourceSnapshotSchema.parse(snapshot)).toEqual(snapshot);
  });

  it('should reject binary objects and embedded base64 image data', () => {
    expect(
      structuredSourceSnapshotSchema.safeParse({
        ...snapshot,
        payload: { image: new Uint8Array([1, 2, 3]) },
      }).success,
    ).toBe(false);
    expect(
      structuredSourceSnapshotSchema.safeParse({
        ...snapshot,
        payload: { image: 'data:image/png;base64,aGVsbG8=' },
      }).success,
    ).toBe(false);
    expect(
      structuredSourceSnapshotSchema.safeParse({
        ...snapshot,
        payload: { imageBase64: 'aGVsbG8=' },
      }).success,
    ).toBe(false);
  });

  it('should reject nonfinite JSON numbers, unsupported values, and non-HTTP source URLs', () => {
    expect(
      structuredSourceSnapshotSchema.safeParse({
        ...snapshot,
        payload: { value: Number.NaN },
      }).success,
    ).toBe(false);
    expect(
      structuredSourceSnapshotSchema.safeParse({
        ...snapshot,
        payload: { value: undefined },
      }).success,
    ).toBe(false);
    expect(
      structuredSourceSnapshotSchema.safeParse({
        ...snapshot,
        sourcePageUrl: 'file:///tmp/image.jpg',
      }).success,
    ).toBe(false);
  });
});

describe('fn:structuredSourceSnapshotSchema canonical values', () => {
  it('should retain nested JSON primitives while rejecting oversized collections and disguised binary strings', () => {
    expect(
      structuredSourceSnapshotSchema.safeParse({
        ...snapshot,
        payload: { values: [null, true, false, 0, 1.25, 'Text'] },
      }).success,
    ).toBe(true);
    expect(
      structuredSourceSnapshotSchema.safeParse({
        ...snapshot,
        payload: Array.from({ length: 10_001 }, () => 1),
      }).success,
    ).toBe(false);
    expect(
      structuredSourceSnapshotSchema.safeParse({
        ...snapshot,
        payload: { image: 'A'.repeat(128) },
      }).success,
    ).toBe(false);
    expect(
      structuredSourceSnapshotSchema.safeParse({
        ...snapshot,
        payload: { text: 'Long human text '.repeat(20) },
      }).success,
    ).toBe(true);
    expect(
      structuredSourceSnapshotSchema.safeParse({
        ...snapshot,
        payload: { text: 'Long human text '.repeat(20) + '.' },
      }).success,
    ).toBe(true);
    expect(
      structuredSourceSnapshotSchema.safeParse({
        ...snapshot,
        payload: Object.fromEntries(
          Array.from({ length: 10_001 }, (_, index) => [
            `field${index}`,
            'text',
          ]),
        ),
      }).success,
    ).toBe(false);
  });
});

it('should reject metadata nested beyond the supported JSON depth', () => {
  const payload = Array.from({ length: 100 }).reduce<unknown>(
    (nested) => ({ nested }),
    'leaf',
  );
  expect(
    structuredSourceSnapshotSchema.safeParse({ ...snapshot, payload }).success,
  ).toBe(false);
});
