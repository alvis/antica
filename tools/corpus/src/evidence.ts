import type { CanonicalJson } from '@antica/contracts';

/**
 * Resolves RFC 6901 with own-property and canonical array-index semantics.
 * @param payload immutable captured JSON
 * @param pointer RFC 6901 pointer
 * @returns captured value, or undefined for invalid or unresolved pointers
 */
export function resolvePointer(
  payload: CanonicalJson,
  pointer: string,
): CanonicalJson | undefined {
  if (pointer === '') {
    return payload;
  }
  if (!pointer.startsWith('/') || /~(?:[^01]|$)/.test(pointer)) {
    return undefined;
  }

  return pointer
    .slice(1)
    .split('/')
    .reduce<CanonicalJson | undefined>((current, token) => {
      const key = token.replace(/~1/g, '/').replace(/~0/g, '~');
      if (current === null || typeof current !== 'object') {
        return undefined;
      }
      if (Array.isArray(current)) {
        return /^(0|[1-9]\d*)$/.test(key) ? current[Number(key)] : undefined;
      }

      return Object.hasOwn(current, key)
        ? (current as Readonly<Record<string, CanonicalJson>>)[key]
        : undefined;
    }, payload);
}

/**
 * Distinguishes evidence from missing, null, blank and empty containers.
 * @param value captured value
 * @returns whether the value contains evidence
 */
export function hasContent(value: CanonicalJson | undefined): boolean {
  if (value === null || value === undefined) {
    return false;
  }
  if (typeof value === 'string') {
    return value.trim().length > 0;
  }
  if (typeof value === 'object') {
    return Object.values(value).some(hasContent);
  }

  return true;
}

/**
 * Finds a verbatim quote in captured leaf text, without JSON escape artifacts.
 * @param value captured value
 * @param quote exact supporting quote
 * @returns whether a populated leaf contains the quote
 */
export function containsQuote(value: CanonicalJson, quote: string): boolean {
  if (value === null) {
    return false;
  }
  if (typeof value === 'object') {
    return Object.values(value).some((item) => containsQuote(item, quote));
  }

  return String(value).includes(quote);
}
