import type { ImageRetrievalPort } from '@antica/application/ports';
import type { ImageMatch } from '@antica/contracts';

import type { ImageSearchEntry } from '../image.js';

/** joins a candidate with its measured descriptor distance */
export interface ScoredImageMatch {
  readonly entry: ImageSearchEntry;
  readonly distance: number;
}

/**
 * returns the grouping identity of a canonical image match
 * @param match canonical image search match
 * @returns collection originalAssetId or reference sourceVersionId:referenceImageId
 */
export function getImageMatchIdentity(match: Omit<ImageMatch, 'rank'>): string {
  return match.ref.kind === 'reference'
    ? `${match.ref.sourceVersionId}:${match.ref.referenceImageId}`
    : match.ref.originalAssetId;
}

/**
 * orders scored candidates and groups their canonical image regions
 * @param scored measured candidate distances
 * @returns ranked matches in stable identity order for tied distances
 */
export function rankImageMatches(
  scored: readonly ScoredImageMatch[],
): ImageMatch[] {
  const ordered = scored.toSorted(
    (left, right) =>
      left.distance - right.distance ||
      getImageMatchIdentity(left.entry.match).localeCompare(
        getImageMatchIdentity(right.entry.match),
      ),
  );
  const matchesById = new Map<string, Omit<ImageMatch, 'rank'>>();
  for (const item of ordered) {
    const key = getImageMatchIdentity(item.entry.match);
    const existing = matchesById.get(key);
    matchesById.set(
      key,
      existing
        ? {
            ...existing,
            matchingRegions: [
              ...existing.matchingRegions,
              ...item.entry.match.matchingRegions,
            ],
          }
        : item.entry.match,
    );
  }

  return [...matchesById.values()].map((match, position): ImageMatch => ({
    ...match,
    rank: position + 1,
  }));
}

/**
 * applies classifications while honoring explicit unknown handling
 * @param entry authorized image entry and classifications
 * @param filters requested classification filters
 * @returns whether the entry matches
 */
export function matchesFilters(
  entry: ImageSearchEntry,
  filters: Parameters<ImageRetrievalPort['search']>[0]['filters'],
): boolean {
  return (
    [
      'objectTypeIds',
      'materialIds',
      'periodIds',
      'regionIds',
      'sourceIds',
    ] as const
  ).every((key) => {
    const selected = filters[key];
    const actual = entry.filterIds[key];

    return (
      !selected?.length ||
      actual.some((id) => selected.includes(id)) ||
      (actual.length === 0 && (filters.includeUnknown ?? true))
    );
  });
}
