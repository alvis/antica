/** leading characters of a UUID shown where the whole identifier would crowd a label */
const shortIdLength = 8;

/**
 * shortens a UUID to the prefix shown in labels
 * @param id full identifier
 * @returns the leading characters a collector can match against the full identifier
 */
export function shortId(id: string): string {
  return id.slice(0, shortIdLength);
}
