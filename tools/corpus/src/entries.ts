import { unique } from './context.js';
import { validateClaim } from './entries/claims.js';
import { validateLabels } from './taxonomy.js';

import type { CorpusEntry } from '@antica/contracts';

import type { CorpusContext, Located } from './context.js';

const categoryMinimum = 5;

/**
 * Validates entry references, original variants, supporting claims and category minima.
 * @param context indexed corpus and diagnostic collector
 * @param minimumProviders required independent supporting providers per category
 */
export function validateEntries(
  context: CorpusContext,
  minimumProviders: number,
): void {
  const providers = new Map<string, Set<string>>();
  for (const record of context.entries.values()) {
    validateEntryReferences(context, record);
    const categoryProviders =
      providers.get(record.value.category) ?? new Set<string>();
    record.value.claims.forEach((claim, index) =>
      validateClaim(context, {
        ...record,
        value: claim,
        entry: record.value,
        providers: categoryProviders,
        path: `$.claims[${index}]`,
      }),
    );
    providers.set(record.value.category, categoryProviders);
  }
  validateCategoryMinima(context, providers, minimumProviders);
}

/**
 * Validates question references and category-consistent relevance judgments.
 * @param context indexed corpus and diagnostic collector
 */
export function validateQueries(context: CorpusContext): void {
  context.check(
    context.queries.length === 1,
    { file: 'queries/owner.json', path: '$' },
    {
      code: 'queries_count',
      message: 'Expected exactly one owner queries file',
    },
  );
  for (const record of context.queries) {
    record.value.questions.forEach((query, index) => {
      const location = { ...record, path: `$.questions[${index}]` };
      context.check(
        Intl.getCanonicalLocales(query.language)[0] === query.language,
        { ...location, path: `${location.path}.language` },
        {
          code: 'canonical_language',
          message: 'Question language must use canonical BCP47 spelling',
        },
      );
      unique(
        context,
        query.relevance.map((judgment) => judgment.entryId),
        { ...location, path: `${location.path}.relevance` },
      );
      query.relevance.forEach((judgment, ordinal) =>
        context.check(
          context.entries.get(judgment.entryId)?.value.category ===
            query.category,
          {
            ...location,
            path: `${location.path}.relevance[${ordinal}].entryId`,
          },
          {
            code: 'query_entry',
            message:
              'Relevance judgment must refer to an entry in the question category',
          },
        ),
      );
    });
  }
}

/**
 * Checks the required category inventory and independent supporting providers.
 * @param context indexed corpus and diagnostic collector
 * @param providers independent supporting providers per category
 * @param minimumProviders required independent supporting providers per category
 */
function validateCategoryMinima(
  context: CorpusContext,
  providers: Map<string, Set<string>>,
  minimumProviders: number,
): void {
  for (const category of ['ceramics', 'bronzes', 'jades', 'furniture']) {
    const entries = [...context.entries.values()].filter(
      (entry) => entry.value.category === category,
    );
    const location = { file: `entries/${category}`, path: '$' };
    context.check(
      entries.filter((entry) => entry.value.entryType !== 'object_example')
        .length >= categoryMinimum,
      location,
      {
        code: 'explanatory_minimum',
        message: 'Category requires at least five explanatory entries',
      },
    );
    context.check(
      entries.filter((entry) => entry.value.entryType === 'object_example')
        .length >= categoryMinimum,
      location,
      {
        code: 'object_minimum',
        message: 'Category requires at least five object examples',
      },
    );
    context.check(
      (providers.get(category)?.size ?? 0) >= minimumProviders,
      location,
      {
        code: 'provider_minimum',
        message: `Category requires at least ${minimumProviders} supporting providers`,
      },
    );
  }
}

/**
 * Checks category membership and localized topic references.
 * @param context indexed corpus and diagnostic collector
 * @param record typed evidence and its owning diagnostic location
 */
function validateEntryReferences(
  context: CorpusContext,
  record: Located<CorpusEntry>,
): void {
  const entry = record.value;
  validateLabels(context, entry.titles, { ...record, path: '$.titles' });
  entry.aliases.forEach((label, index) =>
    context.check(
      Intl.getCanonicalLocales(label.language)[0] === label.language,
      { ...record, path: `$.aliases[${index}].language` },
      {
        code: 'canonical_language',
        message: 'Alias language must use canonical BCP47 spelling',
      },
    ),
  );
  unique(
    context,
    entry.topics.map((topic) => topic.topicId),
    { ...record, path: '$.topics' },
  );
  context.check(
    entry.topics.some(
      (topic) => topic.topicId === `antica:topic:${entry.category}`,
    ),
    { ...record, path: '$.topics' },
    { code: 'entry_category', message: 'Entry must link its category root' },
  );
  entry.topics.forEach((topic, index) =>
    context.check(
      context.topics.has(topic.topicId),
      { ...record, path: `$.topics[${index}].topicId` },
      { code: 'entry_topic', message: 'Entry topic must exist' },
    ),
  );

  validateEntryObjects(context, record);
}

/**
 * Checks source/image bindings and local claim identities.
 * @param context indexed corpus and diagnostic collector
 * @param record typed evidence and its owning diagnostic location
 */
function validateEntryObjects(
  context: CorpusContext,
  record: Located<CorpusEntry>,
): void {
  const entry = record.value;
  unique(context, entry.externalObjectIds, {
    ...record,
    path: '$.externalObjectIds',
  });
  entry.externalObjectIds.forEach((id, index) =>
    context.check(
      context.sources.has(id),
      { ...record, path: `$.externalObjectIds[${index}]` },
      { code: 'entry_source', message: 'External object source must exist' },
    ),
  );
  unique(context, entry.imageIds, { ...record, path: '$.imageIds' });
  entry.imageIds.forEach((id, index) => {
    const image = context.images.get(id);
    context.check(
      image !== undefined && entry.externalObjectIds.includes(image.source.id),
      { ...record, path: `$.imageIds[${index}]` },
      {
        code: 'entry_image',
        message: 'Entry image must belong to a bound source',
      },
    );
  });
  unique(
    context,
    entry.claims.map((claim) => claim.claimKey),
    { ...record, path: '$.claims' },
  );
  unique(
    context,
    entry.claims.map((claim) => `${claim.section}:${claim.ordinal}`),
    { ...record, path: '$.claims' },
  );
}
