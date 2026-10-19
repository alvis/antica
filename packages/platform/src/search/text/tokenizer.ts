import { createHash } from 'node:crypto';

import { domainPhrases } from './dictionary.js';

/** normalized query and document tokens, with a lower-weight Han lane */
export interface SearchTokens {
  readonly tokens: string[];
  readonly bigrams: string[];
}

const segmenter = new Intl.Segmenter('zh-Hant', { granularity: 'word' });
const dictionary = [...new Set(domainPhrases.map(normalizeSearchText))].sort();
export const tokenizerVersion = `node-${process.versions.node}:icu-${process.versions.icu}:dict-${createHash('sha256').update(JSON.stringify(dictionary)).digest('hex')}`;

/**
 * folds search copies while preserving source scripts
 * @param text original text
 * @returns accent-folded NFKC lowercase search copy
 */
export function normalizeSearchText(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .normalize('NFC')
    .trim();
}

/**
 * segments searchable originals and curated domain phrases
 * @param text original text, never destructively script-converted
 * @returns word tokens and contiguous Han bigrams
 */
export function tokenizeSearchText(text: string): SearchTokens {
  const normalized = normalizeSearchText(text);
  const words = [...segmenter.segment(normalized)]
    .filter((part) => part.isWordLike)
    .map((part) => part.segment);
  const phrases = dictionary.filter((phrase) => normalized.includes(phrase));
  const bigrams = [...normalized.matchAll(/\p{Script=Han}+/gu)].flatMap(
    ([run]) => {
      const characters = [...run];

      return characters
        .slice(1)
        .map((character, index) => `${characters[index]}${character}`);
    },
  );

  return {
    tokens: [...new Set([...words, ...phrases])],
    bigrams: [...new Set(bigrams)],
  };
}
