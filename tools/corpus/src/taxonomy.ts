import type { CorpusContext, Located, Topic } from './context.js';

const categories = ['ceramics', 'bronzes', 'jades', 'furniture'];

/**
 * Validates category roots, multilingual labels, hierarchy and authority evidence.
 * @param context indexed corpus and diagnostic collector
 */
export function validateTaxonomy(context: CorpusContext): void {
  context.check(
    context.taxonomies.length === 1,
    { file: 'taxonomy.json', path: '$' },
    { code: 'taxonomy_count', message: 'Expected exactly one taxonomy' },
  );
  const roots = [...context.topics.values()].filter(
    (topic) => topic.value.facet === 'category',
  );
  context.check(
    roots.length === categories.length &&
      categories.every((category) =>
        roots.some(
          ({ value }) =>
            value.id === `antica:topic:${category}` &&
            value.parentId === undefined,
        ),
      ),
    { file: 'taxonomy.json', path: '$.topics' },
    {
      code: 'category_roots',
      message: 'Expected exactly the four category roots',
    },
  );
  for (const record of context.topics.values()) {
    validateLabels(context, record.value.labels, record);
    const related = new Set<string>();
    record.value.relatedIds.forEach((id, index) => {
      context.check(
        id !== record.value.id && context.topics.has(id) && !related.has(id),
        { ...record, path: `${record.path}.relatedIds[${index}]` },
        {
          code: 'related_topic',
          message: 'Related topics must exist, be distinct and exclude self',
        },
      );
      related.add(id);
    });
    validateParents(context, record);
    validateMappings(context, record);
  }
}

/**
 * Validates exactly one preferred label in each interface language.
 * @param context indexed corpus and diagnostic collector
 * @param labels localized labels attached to this record
 * @param location owning file and JSON path for diagnostics
 */
export function validateLabels(
  context: CorpusContext,
  labels: ReadonlyArray<{ language: string; kind: string }>,
  location: Located<unknown>,
): void {
  for (const language of ['zh-Hant', 'en']) {
    context.check(
      labels.filter(
        (label) => label.language === language && label.kind === 'preferred',
      ).length === 1,
      location,
      {
        code: 'preferred_labels',
        message: `Expected one preferred ${language} label`,
      },
    );
  }
  labels.forEach((label, index) =>
    context.check(
      Intl.getCanonicalLocales(label.language)[0] === label.language,
      { ...location, path: `${location.path}[${index}].language` },
      {
        code: 'canonical_language',
        message: 'Language must use canonical BCP47 spelling',
      },
    ),
  );
}

/**
 * Walks each parent chain, rejecting missing parents, facet jumps and cycles.
 * @param context indexed corpus and diagnostic collector
 * @param record typed evidence and its owning diagnostic location
 */
function validateParents(context: CorpusContext, record: Located<Topic>): void {
  const visited = new Set([record.value.id]);
  let parentId = record.value.parentId;
  while (parentId !== undefined) {
    const location = { ...record, path: `${record.path}.parentId` };
    const parent = context.topics.get(parentId);
    context.check(parent !== undefined, location, {
      code: 'parent_missing',
      message: 'Parent topic must exist',
    });
    if (parent === undefined) {
      break;
    }
    context.check(parent.value.facet === record.value.facet, location, {
      code: 'parent_facet',
      message: 'Parent must belong to the same facet',
    });
    context.check(!visited.has(parentId), location, {
      code: 'parent_cycle',
      message: 'Topic parents cannot form a cycle',
    });
    if (visited.has(parentId)) {
      break;
    }
    visited.add(parentId);
    parentId = parent.value.parentId;
  }
}

/**
 * Checks authority mapping citations and review provenance.
 * @param context indexed corpus and diagnostic collector
 * @param record topic and its owning diagnostic location
 */
function validateMappings(
  context: CorpusContext,
  record: Located<Topic>,
): void {
  record.value.mappings.forEach((mapping, index) => {
    const location = { ...record, path: `${record.path}.mappings[${index}]` };
    const citation = context.citations.get(mapping.citationId);
    context.check(citation !== undefined, location, {
      code: 'mapping_citation',
      message: 'Authority mapping citation must resolve',
    });
    if (citation !== undefined) {
      context.check(
        context.locators.get(citation.value.locatorId)?.source.id ===
          citation.source.id,
        location,
        {
          code: 'mapping_locator',
          message: 'Authority evidence must have a source-bound locator',
        },
      );
    }
    context.check(
      mapping.reviewState !== 'reviewed' ||
        Boolean(mapping.reviewedBy && mapping.reviewedAt),
      location,
      {
        code: 'mapping_review',
        message: 'Reviewed mappings require an actor and UTC time',
      },
    );
  });
}
