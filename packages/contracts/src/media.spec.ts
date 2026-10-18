import { describe, expect, it } from 'vitest';

import {
  rectRegionSchema,
  regionSchema,
  uploadResumeSchema,
  uploadSessionSchema,
} from './media.js';

const assetId = '00000000-0000-4000-8000-000000000001';
const expiresAt = '2026-10-18T12:15:00.000Z';
const single = {
  assetId,
  expiresAt,
  mode: 'single',
  putUrl: 'https://storage.example/original',
  headers: { 'Content-Type': 'image/png' },
};
const multipart = {
  assetId,
  expiresAt,
  mode: 'multipart',
  uploadId: 'provider-upload',
  parts: [
    {
      partNumber: 1,
      offset: 0,
      byteLength: 16,
      putUrl: 'https://storage.example/part/1',
      headers: {},
    },
  ],
};

describe('rectangle region validation', () => {
  it('should keep a rectangle within the normalized original image', () => {
    const region = { kind: 'rect', x: 0.5, y: 0.5, width: 0.5, height: 0.5 };

    expect(rectRegionSchema.safeParse(region).success).toBe(true);
    expect(rectRegionSchema.safeParse({ ...region, width: 0.6 }).success).toBe(
      false,
    );
    expect(rectRegionSchema.safeParse({ ...region, height: 0.6 }).success).toBe(
      false,
    );
  });
});

describe('image region validation', () => {
  it('should reject a polygon with no area and accept an actual region', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
    ];

    expect(regionSchema.safeParse({ kind: 'polygon', points }).success).toBe(
      true,
    );
    expect(
      regionSchema.safeParse({
        kind: 'polygon',
        points: points.map((point) => ({ ...point, y: 0 })),
      }).success,
    ).toBe(false);
    expect(
      regionSchema.safeParse({ kind: 'polygon', points: points.slice(0, 2) })
        .success,
    ).toBe(false);
  });
});

describe('resumed upload session validation', () => {
  it('should extend a multipart session with the parts storage already holds', () => {
    const resumed = {
      ...multipart,
      uploadedParts: [{ partNumber: 1, etag: '"part-1"' }],
    };

    expect(uploadResumeSchema.parse(resumed)).toEqual(resumed);
    expect(
      uploadResumeSchema.safeParse({
        ...multipart,
        uploadedParts: [{ partNumber: 0, etag: '"part-1"' }],
      }).success,
    ).toBe(false);
    expect(
      uploadResumeSchema.safeParse({
        ...multipart,
        uploadedParts: [{ partNumber: 1, etag: '' }],
      }).success,
    ).toBe(false);
  });

  it('should require an empty uploaded-part list for a single upload', () => {
    expect(
      uploadResumeSchema.parse({ ...single, uploadedParts: [] }),
    ).toMatchObject({ mode: 'single', uploadedParts: [] });
    expect(
      uploadResumeSchema.safeParse({
        ...single,
        uploadedParts: [{ partNumber: 1, etag: '"part-1"' }],
      }).success,
    ).toBe(false);
    expect(uploadResumeSchema.safeParse(single).success).toBe(false);
  });

  it('should keep the start session strict and reject unknown resume fields', () => {
    expect(uploadSessionSchema.parse(multipart)).toEqual(multipart);
    expect(
      uploadSessionSchema.safeParse({ ...multipart, uploadedParts: [] })
        .success,
    ).toBe(false);
    expect(
      uploadResumeSchema.safeParse({
        ...single,
        uploadedParts: [],
        unexpected: true,
      }).success,
    ).toBe(false);
  });
});
