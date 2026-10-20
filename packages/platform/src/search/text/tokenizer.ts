import { createHash } from 'node:crypto';

import { domainPhrases } from './dictionary.js';

/** normalized query and document tokens, with a lower-weight Han lane */
export interface SearchTokens {
  readonly tokens: string[];
  readonly bigrams: string[];
}

const segmenter = new Intl.Segmenter('zh-Hant', { granularity: 'word' });
const dictionary = [...new Set(domainPhrases.map(normalizeSearchText))].sort();
const queryStopWords = [
  '如何',
  '怎樣',
  '有何',
  '哪些',
  '是否',
  '能否',
  '可否',
  '為甚麼',
  '為什麼',
  '為何',
  '應',
  '可',
  '與',
  '和',
  '的',
  '嗎',
  '呢',
  '館藏',
  '館方',
  '說明',
  '資料',
  '證據',
  '比較',
  '記錄',
  '確定',
  '證明',
  '這',
  '這只',
  '這種',
  '這能',
  '一件',
  '可以',
  '可供',
  '已有',
  '只能',
  '可能',
  '足以',
  '同時',
  '如何',
  '是',
  '在',
  '上',
  '及',
  '或',
  '其',
  '它',
  '而',
  '能',
  '所稱',
  '應該',
  'how',
  'what',
  'which',
  'whether',
  'why',
  'can',
  'could',
  'should',
  'would',
  'museum',
  'record',
  'records',
  'evidence',
  'compare',
  'describe',
  'explain',
  'a',
  'an',
  'the',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'do',
  'does',
  'did',
  'of',
  'to',
  'for',
  'in',
  'on',
  'at',
  'by',
  'with',
  'and',
  'or',
].map(normalizeSearchText);
const queryStops = new Set(queryStopWords);
const queryStopPattern = new RegExp(
  queryStopWords
    .filter((word) => word.length > 1)
    .sort((a, b) => b.length - a.length)
    .map(queryWordPattern)
    .join('|'),
  'gu',
);
const protectedQueryPattern = new RegExp(
  `「[^」]+」|『[^』]+』|"[^"]+"|“[^”]+”|${dictionary
    .filter((phrase) => phrase.length > 1)
    .toSorted((a, b) => b.length - a.length)
    .map(queryWordPattern)
    .join('|')}`,
  'gu',
);
export const tokenizerVersion = `node-${process.versions.node}:icu-${process.versions.icu}:dict-${createHash('sha256').update(JSON.stringify(dictionary)).digest('hex')}:stops-${createHash(
  'sha256',
)
  .update(JSON.stringify([...queryStops].sort()))
  .digest('hex')}`;

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

/**
 * removes question scaffolding while preserving quoted spans and domain phrases
 * @param text bounded natural-language search question
 * @returns meaningful query tokens and a lowest-weight Han fallback
 */
export function analyzeSearchQuery(text: string): SearchTokens {
  const normalized = normalizeSearchText(text);
  const tokens: string[] = [];
  const bigrams: string[] = [];
  let offset = 0;
  for (const match of normalized.matchAll(protectedQueryPattern)) {
    const preceding = analyzeQueryWords(normalized.slice(offset, match.index));
    const phrase = match[0].replace(/^[「『"“]|[」』"”]$/gu, '').trim();
    tokens.push(...preceding.tokens, phrase);
    bigrams.push(...preceding.bigrams, ...tokenizeSearchText(phrase).bigrams);
    offset = match.index + match[0].length;
  }
  const tail = analyzeQueryWords(normalized.slice(offset));

  return {
    tokens: [...new Set([...tokens, ...tail.tokens])],
    bigrams: [...new Set([...bigrams, ...tail.bigrams])],
  };
}

/**
 * removes multiword scaffolding before segmentation and standalone particles after it
 * @param text unquoted question fragment
 * @returns tokens without query stop words
 */
function analyzeQueryWords(text: string): SearchTokens {
  const stripped = text.replace(queryStopPattern, ' ');
  const meaningful = [...segmenter.segment(stripped)]
    .map((part) => (queryStops.has(part.segment) ? ' ' : part.segment))
    .join('');

  const result = tokenizeSearchText(meaningful);

  return /^\p{Script=Han}{3,4}$/u.test(meaningful.trim())
    ? { tokens: [meaningful.trim()], bigrams: result.bigrams }
    : result;
}

/**
 * escapes literal dictionary terms with Latin word boundaries
 * @param word normalized phrase or stop word
 * @returns escaped Unicode regular-expression alternative
 */
function queryWordPattern(word: string): string {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  return /^[a-z0-9]/u.test(word)
    ? `(?<![a-z0-9])${escaped}(?![a-z0-9])`
    : escaped;
}
