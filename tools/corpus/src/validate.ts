import { corpusFileSchema } from '@antica/contracts';

import { canonicalJson } from './canonical.js';
import { CorpusContext, indexFile } from './context.js';
import { validateEntries, validateQueries } from './entries.js';
import { validateManifest } from './manifest.js';
import { validateSources } from './sources.js';
import { validateTaxonomy } from './taxonomy.js';

/** Exact UTF-8 content and a path relative to the corpus directory. */
export interface CorpusDocument {
  path: string;
  text: string;
}
/** Release selection and supporting-provider diversity policy. */
export interface CorpusValidationOptions {
  release?: string;
  minimumProviders?: number;
}
/** A stable failure code with a human-readable file and JSON location. */
export interface CorpusIssue {
  file: string;
  path: string;
  code: string;
  message: string;
}
/** Validation diagnostics and measured corpus inventory. */
export interface CorpusValidationResult {
  issues: CorpusIssue[];
  counts: {
    topics: number;
    entries: number;
    claims: number;
    sources: number;
    images: number;
    questions: number;
  };
}

/**
 * Validates a complete offline release and returns file-local diagnostics.
 * @param documents all corpus files, including README and release manifest
 * @param options selected version and minimum independent supporting providers
 * @returns deterministic issues and inventory counts
 */
export function validateCorpusDocuments(
  documents: readonly CorpusDocument[],
  options: CorpusValidationOptions = {},
): CorpusValidationResult {
  const context = new CorpusContext(documents);
  for (const document of [...documents].sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  )) {
    if (!document.path.endsWith('.json')) {
      continue;
    }
    parseDocument(context, document);
  }
  if (context.issues.length === 0) {
    validateManifest(context, options.release);
    validateTaxonomy(context);
    validateSources(context);
    validateEntries(context, options.minimumProviders ?? 2);
    validateQueries(context);
  }

  return {
    issues: context.issues,
    counts: {
      topics: context.topics.size,
      entries: context.entries.size,
      claims: [...context.entries.values()].reduce(
        (sum, entry) => sum + entry.value.claims.length,
        0,
      ),
      sources: context.sources.size,
      images: new Set(
        [...context.images.values()].map((image) => image.value.remoteUrl),
      ).size,
      questions: context.queries.reduce(
        (sum, query) => sum + query.value.questions.length,
        0,
      ),
    },
  };
}

/**
 * Parses one strict JSON file before indexing any references.
 * @param context indexed corpus and diagnostic collector
 * @param document exact JSON bytes and corpus-relative path
 */
function parseDocument(context: CorpusContext, document: CorpusDocument): void {
  const location = { file: document.path, path: '$' };
  let input: unknown;
  try {
    input = JSON.parse(document.text);
  } catch (error) {
    context.check(false, location, {
      code: 'json',
      message: (error as Error).message,
    });

    return;
  }
  const parsed = corpusFileSchema.safeParse(input);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const path = issue.path.reduce<string>(
        (result, key) =>
          typeof key === 'number'
            ? `${result}[${key}]`
            : `${result}[${JSON.stringify(String(key))}]`,
        '$',
      );
      context.check(
        false,
        { ...location, path },
        { code: 'schema', message: issue.message },
      );
    }

    return;
  }
  context.check(document.text === `${canonicalJson(input)}\n`, location, {
    code: 'canonical_bytes',
    message:
      'JSON must use sorted keys, canonical values and one trailing newline',
  });
  indexFile(context, { ...location, value: parsed.data });
}
