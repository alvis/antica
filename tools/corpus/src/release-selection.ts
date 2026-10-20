import { corpusReleaseSchema } from '@antica/contracts';

import type { CorpusDocument } from './validate.js';

/**
 * limits an explicit release to its immutable members while retaining manifest diagnostics
 * @param documents exact corpus files from the shared release directory
 * @param version selected release, or latest-version full-directory validation
 * @returns documents eligible for validation and installation
 */
export function selectCorpusReleaseDocuments(
  documents: readonly CorpusDocument[],
  version?: string,
): CorpusDocument[] {
  if (version === undefined) {
    return [...documents];
  }
  const selected = documents
    .filter(
      (document) =>
        document.path.startsWith('releases/') &&
        document.path.endsWith('.json'),
    )
    .flatMap((document) => {
      try {
        const parsed = corpusReleaseSchema.safeParse(JSON.parse(document.text));

        return parsed.success && parsed.data.version === version
          ? [parsed.data]
          : [];
      } catch {
        // invalid manifests remain in the selected documents for normal parser diagnostics
        return [];
      }
    });
  if (selected.length !== 1) {
    return [...documents];
  }
  const members = new Set(selected[0]!.files.map((file) => file.path));

  return documents.filter(
    (document) =>
      document.path.startsWith('releases/') || members.has(document.path),
  );
}

/**
 * selects the newest numeric semantic version unless a version was requested
 * @param versions available manifest versions
 * @param requested explicit version selector
 * @returns selected version, or undefined when no manifests exist
 */
export function selectCorpusReleaseVersion(
  versions: readonly string[],
  requested?: string,
): string | undefined {
  return (
    requested ??
    [...versions].sort((left, right) => {
      const leftParts = left.split('.').map(BigInt);
      const rightParts = right.split('.').map(BigInt);
      for (const [index, leftPart] of leftParts.entries()) {
        const rightPart = rightParts[index]!;
        if (leftPart !== rightPart) {
          return leftPart > rightPart ? -1 : 1;
        }
      }

      return 0;
    })[0]
  );
}
