import { Linking } from 'react-native';

import type {
  KnowledgeContentEnvelopeV2,
  KnowledgeSearchQuery,
} from '@antica/contracts';

/**
 * builds the discovery wire query without duplicating its shared contract
 * @param input validated discovery selection
 * @returns encoded API search path
 */
export function knowledgeSearchPath(input: KnowledgeSearchQuery): string {
  const parameters = new URLSearchParams({
    view: input.view,
    locale: input.locale,
    limit: String(input.limit),
  });
  if (input.q !== undefined) {
    parameters.set('q', input.q);
  }
  if (input.cursor) {
    parameters.set('cursor', input.cursor);
  }
  if (input.topics) {
    parameters.set('topics', JSON.stringify(input.topics));
  }
  for (const key of ['providers', 'languages', 'entryTypes'] as const) {
    for (const value of input[key] ?? []) {
      parameters.append(key, value);
    }
  }

  return `/v1/knowledge/search?${parameters}`;
}

/**
 * opens only remote HTTP sources through native linking
 * @param url source page supplied by the validated API
 * @returns completion of the native open action
 * @throws {TypeError} when the source is not an HTTP URL
 */
export async function openKnowledgeSource(url: string): Promise<void> {
  const parsed = new URL(url);
  if (
    !['http:', 'https:'].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password
  ) {
    throw new TypeError('Invalid source URL');
  }
  await Linking.openURL(url);
}

/**
 * selects reviewed translations while retaining original-language provenance
 * @param claim original claim and its translation variants
 * @param locale requested interface language
 * @param original whether the reader requested original text
 * @returns text, language and whether original fallback was necessary
 */
export function claimText(
  claim: KnowledgeContentEnvelopeV2['claims'][number],
  locale: string,
  original: boolean,
): { text: string; language: string; fallback: boolean } {
  const translated =
    !original &&
    claim.variants.find(
      (variant) =>
        variant.kind === 'translation' &&
        variant.language === locale &&
        variant.review.state === 'reviewed',
    );

  return translated
    ? { text: translated.text, language: translated.language, fallback: false }
    : {
        text: claim.originalText,
        language: claim.originalLanguage,
        fallback: !original && claim.originalLanguage !== locale,
      };
}
