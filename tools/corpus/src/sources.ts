import { canonicalJson, sha256 } from './canonical.js';
import { containsQuote, hasContent, resolvePointer } from './evidence.js';
import { discoverImageUrls } from './images.js';

import type { CorpusSource } from '@antica/contracts';

import type {
  CorpusContext,
  Located,
  SourceChild,
  Locator,
} from './context.js';

interface RightsRecord {
  source: CorpusSource;
  right: CorpusSource['fieldRights'][number];
  location: Located<unknown>;
}

/**
 * Validates immutable payloads, located quotations, rights observations and image sets.
 * @param context indexed corpus and diagnostic collector
 */
export function validateSources(context: CorpusContext): void {
  for (const record of context.sources.values()) {
    const source = record.value;
    context.check(
      sha256(canonicalJson(source.payload)) === source.payloadHash,
      { ...record, path: '$.payloadHash' },
      {
        code: 'payload_hash',
        message: 'Payload hash must match the canonical captured payload',
      },
    );
    source.languages.forEach((language, index) =>
      context.check(
        Intl.getCanonicalLocales(language)[0] === language,
        { ...record, path: `$.languages[${index}]` },
        {
          code: 'canonical_language',
          message: 'Source languages must use canonical BCP47 spelling',
        },
      ),
    );
    source.locators.forEach((locator, index) =>
      validateLocator(context, {
        ...record,
        value: locator,
        source,
        path: `$.locators[${index}]`,
      }),
    );
    validateCitations(context, record);
    validateSourceRights(context, record);
    validateImages(context, record);
  }
}

/**
 * Validates the immutable field or captured web section behind a locator.
 * @param context indexed corpus and diagnostic collector
 * @param record typed evidence and its owning diagnostic location
 */
function validateLocator(
  context: CorpusContext,
  record: SourceChild<Locator>,
): void {
  const { value: locator, source } = record;
  if (locator.kind === 'web') {
    context.check(
      new URL(locator.url).pathname !== '/' &&
        locator.section.trim().length > 0 &&
        containsQuote(source.payload, locator.excerpt),
      record,
      {
        code: 'web_capture',
        message:
          'Web evidence needs a specific page, section and verbatim captured excerpt',
      },
    );

    return;
  }
  context.check(
    locator.provider === source.provider &&
      locator.objectId === source.objectId,
    record,
    {
      code: 'locator_identity',
      message: 'Structured locator must identify its enclosing provider object',
    },
  );
  const value = resolvePointer(source.payload, locator.fieldPath);
  context.check(
    value !== undefined,
    { ...record, path: `${record.path}.fieldPath` },
    {
      code: 'pointer',
      message: 'JSON Pointer must resolve in the captured payload',
    },
  );
  if (value !== undefined) {
    context.check(
      sha256(canonicalJson(value)) === locator.valueHash,
      { ...record, path: `${record.path}.valueHash` },
      {
        code: 'value_hash',
        message: 'Value hash must match the canonical captured field',
      },
    );
    context.check(
      containsQuote(value, locator.excerpt),
      { ...record, path: `${record.path}.excerpt` },
      {
        code: 'locator_excerpt',
        message: 'Locator excerpt must occur verbatim in its captured value',
      },
    );
  }
}

/**
 * Checks evidence hashes for optional field-bound rights facts without gating on designation.
 * @param context indexed corpus and diagnostic collector
 * @param record captured rights fact and owning snapshot
 */
function validateRights(context: CorpusContext, record: RightsRecord): void {
  const { source, right, location } = record;
  if (right.fieldPath === undefined) {
    return;
  }
  const value = resolvePointer(source.payload, right.fieldPath);
  context.check(
    value !== undefined && sha256(canonicalJson(value)) === right.evidenceHash,
    location,
    {
      code: 'rights_evidence',
      message:
        'Field-bound observed rights must retain their captured evidence hash',
    },
  );
}

/**
 * Checks citation version identity, quotes and populated support.
 * @param context indexed corpus and diagnostic collector
 * @param record typed evidence and its owning diagnostic location
 */
function validateCitations(
  context: CorpusContext,
  record: Located<CorpusSource>,
): void {
  const source = record.value;
  source.citations.forEach((citation, index) => {
    const location = { ...record, path: `$.citations[${index}]` };
    const locator = source.locators.find(
      (item) => item.id === citation.locatorId,
    );
    context.check(
      citation.sourceContentId === source.id &&
        citation.payloadHash === source.payloadHash,
      location,
      {
        code: 'citation_version',
        message: 'Citation must bind the enclosing source and payload version',
      },
    );
    context.check(locator !== undefined, location, {
      code: 'citation_locator',
      message: 'Citation locator must belong to its source',
    });
    if (locator !== undefined) {
      context.check(
        locator.excerpt.includes(citation.quote),
        { ...location, path: `${location.path}.quote` },
        {
          code: 'citation_quote',
          message: 'Citation quote must occur verbatim in the captured excerpt',
        },
      );
    }
    if (citation.relation === 'supports') {
      context.check(
        hasContent(citation.quote) &&
          !['null', '[]', '{}', '""'].includes(citation.quote.trim()),
        location,
        {
          code: 'support_empty',
          message: 'Supporting quotes must contain evidence',
        },
      );
      if (locator?.kind === 'structured') {
        context.check(
          hasContent(resolvePointer(source.payload, locator.fieldPath)),
          location,
          {
            code: 'support_empty',
            message: 'Supporting field must be non-empty',
          },
        );
      }
    }
  });
}

/**
 * Verifies optional source rights evidence without an eligibility allowlist.
 * @param context indexed corpus and diagnostic collector
 * @param record typed evidence and its owning diagnostic location
 */
function validateSourceRights(
  context: CorpusContext,
  record: Located<CorpusSource>,
): void {
  const source = record.value;
  const rights = [source.rights, ...source.fieldRights];
  rights.forEach((right, index) => {
    if (right !== undefined) {
      validateRights(context, {
        source,
        right,
        location: {
          ...record,
          path: index === 0 ? '$.rights' : `$.fieldRights[${index - 1}]`,
        },
      });
    }
  });
}

/**
 * Verifies exact captured image sets and attribution.
 * @param context indexed corpus and diagnostic collector
 * @param record typed evidence and its owning diagnostic location
 */
function validateImages(
  context: CorpusContext,
  record: Located<CorpusSource>,
): void {
  const source = record.value;
  const discovered = discoverImageUrls(source.payload);
  const recorded = new Set(source.images.map((image) => image.remoteUrl));
  context.check(
    recorded.size === source.images.length,
    { ...record, path: '$.images' },
    {
      code: 'image_duplicate_url',
      message: 'Each image URL must appear exactly once per snapshot',
    },
  );
  context.check(
    discovered.size === recorded.size &&
      [...discovered].every((url) => recorded.has(url)),
    { ...record, path: '$.images' },
    {
      code: 'image_urls',
      message: `Declared images must equal the complete discovered URL set (discovered ${discovered.size}, declared ${recorded.size})`,
    },
  );
  source.images.forEach((image, index) => {
    const location = { ...record, path: `$.images[${index}]` };
    context.check(
      image.provider === source.provider &&
        image.sourcePageUrl === source.sourcePageUrl,
      location,
      {
        code: 'image_attribution',
        message: 'Image must retain its source provider and source page URL',
      },
    );
    if (image.locatorId !== undefined) {
      context.check(
        source.locators.some((locator) => locator.id === image.locatorId),
        location,
        {
          code: 'image_locator',
          message: 'Image locator must belong to its source',
        },
      );
    }
    if (image.rights !== undefined) {
      validateRights(context, {
        source,
        right: image.rights,
        location: {
          ...location,
          path: `${location.path}.rights`,
        },
      });
    }
  });
}
