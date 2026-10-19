/**
 * names a record field, proposable or edited by hand, for automation identifiers, which are kebab-case
 * @param field record field, such as `collectorJudgment`
 * @returns the kebab-case field name, such as `collector-judgment`
 */
export function proposalFieldTestId(field: string): string {
  return field.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}
