import { expect, it } from '@jest/globals';

import { readApiOrigin } from './api-origin';

it.each([undefined, ''])(
  'should reject missing API configuration %s',
  (value) => {
    expect(() => readApiOrigin(value, true)).toThrow(
      'EXPO_PUBLIC_API_URL is required.',
    );
  },
);

it('should accept an explicit local HTTP origin only for development', () => {
  expect(readApiOrigin('HTTP://LOCALHOST:3000/', true)).toBe(
    'http://localhost:3000',
  );
  expect(() => readApiOrigin('http://localhost:3000', false)).toThrow(
    'EXPO_PUBLIC_API_URL must use HTTPS outside development.',
  );
});

it.each([
  'not-a-url',
  'ftp://api.example',
  'https://user:secret@api.example',
  'https://api.example/path',
  'https://api.example?secret=value',
  'https://api.example#section',
])('should reject an invalid API origin %s', (value) => {
  expect(() => readApiOrigin(value, false)).toThrow(
    'EXPO_PUBLIC_API_URL must be an HTTP(S) origin without credentials, path, query, or fragment.',
  );
});

it('should accept and canonicalize an HTTPS origin in production', () => {
  expect(readApiOrigin('https://API.EXAMPLE:443/', false)).toBe(
    'https://api.example',
  );
});
