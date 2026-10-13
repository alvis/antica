import type { IndexIdentity } from '@antica/application/ports';

/** describes compatibility without silently changing an embedding space */
export type IndexCompatibility =
  { readonly valid: true } | { readonly valid: false; readonly reason: string };

/**
 * checks all identity fields before querying an index
 * @param expected configured query space
 * @param actual persisted index space
 * @returns compatibility result
 */
export function validateIndexSpace(
  expected: IndexIdentity,
  actual: IndexIdentity,
): IndexCompatibility {
  if (
    expected.embeddingModelId !== actual.embeddingModelId ||
    expected.dimensions !== actual.dimensions ||
    expected.indexVersion !== actual.indexVersion
  ) {
    return {
      valid: false,
      reason:
        'The query and index must use the same embedding model, dimensions, and index version.',
    };
  }

  return { valid: true };
}
