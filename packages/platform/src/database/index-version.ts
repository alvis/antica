import { createHash } from 'node:crypto';

/**
 * maps a public text-index version to its stable database identity
 * @param value public index version or existing UUID
 * @returns UUID used by index-version foreign keys
 */
export function indexVersionId(value: string): string {
  if (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      value,
    )
  ) {
    return value;
  }
  const digest = createHash('sha256')
    .update(`text-index-version:${value}`)
    .digest('hex');

  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}
