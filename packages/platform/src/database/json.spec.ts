import { describe, expect, it } from 'vitest';

import { Prisma } from './generated/client.js';
import { jsonValue, nullableJson } from './json.js';

describe('fn:nullableJson', () => {
  it.each([null, undefined, new Date('invalid')])(
    'should encode absent or serialized-null values as SQL NULL (%s)',
    (value) => {
      expect(nullableJson(value)).toBe(Prisma.DbNull);
    },
  );
});

describe('fn:jsonValue', () => {
  it('should preserve literal JSON null separately from SQL NULL', () => {
    expect(jsonValue(null)).toBe(Prisma.JsonNull);
  });
});

describe.each([nullableJson, jsonValue])('fn:%s', (serialize) => {
  it('should preserve JSON data while applying the existing serializer rules', () => {
    expect(
      serialize({
        capturedAt: new Date('2026-10-18T00:00:00Z'),
        values: [1, null, 'text'],
        omitted: undefined,
      }),
    ).toEqual({
      capturedAt: '2026-10-18T00:00:00.000Z',
      values: [1, null, 'text'],
    });
  });
});
