import { createHmac, timingSafeEqual } from 'node:crypto';

interface ThumbnailPage {
  readonly items: ReadonlyArray<{
    readonly id: string;
    readonly coverThumbnail: string | null;
  }>;
}

/**
 * verifies synthetic cover selection and real read signatures outside timings
 * @param page collection response from the seeded corpus
 * @param secret explicit synthetic signer secret
 * @param publicBaseUrl expected local signer's public origin
 * @returns counts of independently verified signed and nullable covers
 */
export function verifyThumbnailPage(
  page: ThumbnailPage,
  secret: string,
  publicBaseUrl: string,
): { signed: number; null: number } {
  let signed = 0;
  let nullable = 0;
  for (const item of page.items) {
    const ordinal = Number(item.id.slice(-12));
    if (ordinal % 5 === 0) {
      if (item.coverThumbnail !== null) {
        throw new Error(`Expected null cover for ${item.id}`);
      }
      nullable++;
      continue;
    }
    if (item.coverThumbnail === null) {
      throw new Error(`Missing thumbnail for ${item.id}`);
    }
    const url = new URL(item.coverThumbnail);
    if (
      url.origin !== publicBaseUrl ||
      !url.pathname.startsWith('/v1/storage/reads/')
    ) {
      throw new Error('Unexpected signed URL origin/path');
    }
    const [body, signature, extra] = url.pathname.split('/').at(-1)!.split('.');
    if (!body || !signature || extra) {
      throw new Error('Malformed thumbnail token');
    }
    const actual = Buffer.from(signature, 'base64url');
    const expected = createHmac('sha256', secret).update(body).digest();
    if (
      actual.length !== expected.length ||
      !timingSafeEqual(actual, expected)
    ) {
      throw new Error('Thumbnail HMAC mismatch');
    }
    const token = JSON.parse(
      Buffer.from(body, 'base64url').toString('utf8'),
    ) as { mode: string; key: string; expiresAt: number };
    const expectedKey = `synthetic-benchmark/thumbnails/${(ordinal - 1) * 20 + 1}.jpg`;
    if (token.mode !== 'read' || token.key !== expectedKey) {
      throw new Error('Wrong thumbnail target');
    }
    const remainingMs = token.expiresAt - Date.now();
    if (
      !Number.isFinite(remainingMs) ||
      remainingMs < 290_000 ||
      remainingMs > 300_000
    ) {
      throw new Error('Unexpected thumbnail expiry');
    }
    signed++;
  }

  return { signed, null: nullable };
}
