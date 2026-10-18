import type { ProposedChange } from '@antica/contracts';

/**
 * names a proposable record field for automation identifiers, which are kebab-case
 * @param field proposable record field, such as `collectorJudgment`
 * @returns the kebab-case field name, such as `collector-judgment`
 */
export function proposalFieldTestId(field: ProposedChange['field']): string {
  return field.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}
