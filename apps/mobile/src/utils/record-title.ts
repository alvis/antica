/**
 * names an item from the collector's saved value, without presenting a suggestion as fact
 * @param name saved record name
 * @param unnamed localized fallback for an unnamed item
 * @returns the saved name or the localized unnamed label
 */
export function recordTitle(name: string | null, unnamed: string): string {
  return name ?? unnamed;
}
