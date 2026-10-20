import { KnowledgeProviderError } from '@antica/contracts';

import { canonicalJson, hash, stableId } from './canonical.js';

import type {
  CanonicalJson,
  MappedObject,
  ProviderSnapshot,
} from '@antica/contracts';

/** preserves the actual detail response and its unknown fields */
export type MetRecord = Readonly<Record<string, CanonicalJson>>;

interface CitationContext {
  readonly snapshot: ProviderSnapshot;
  readonly source: MappedObject['source'];
  readonly fieldPath: string;
  readonly value: CanonicalJson;
}

const rightsFields = ['isPublicDomain', 'rightsAndReproduction'];

/**
 * validates the detail envelope at the upstream metadata boundary
 * @param data canonical response body
 * @returns object fields without stripping unknown metadata
 * @throws {KnowledgeProviderError} when the detail envelope is malformed
 */
export function readRecord(data: CanonicalJson): MetRecord {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new KnowledgeProviderError({
      code: 'INVALID_RESPONSE',
      retryable: false,
    });
  }

  return data as MetRecord;
}

/**
 * retains observed rights wording, including an explicitly empty rights text
 * @param snapshot captured response and observation time
 * @returns evidence facts without licence or permission inference
 */
export function observeRights(
  snapshot: ProviderSnapshot,
): NonNullable<ProviderSnapshot['observedRights']> {
  const record = readRecord(snapshot.payload);

  return rightsFields.flatMap((field) => {
    const value = record[field];

    return value === undefined
      ? []
      : [
          {
            statement: value === '' ? canonicalJson(value) : excerpt(value),
            fieldPath: `/${field}`,
            observedAt: snapshot.retrievedAt,
            evidenceUrl: snapshot.sourcePageUrl,
            evidenceHash: hash(canonicalJson(value)),
          },
        ];
  });
}

/**
 * preserves source strings verbatim and uses canonical JSON for compound values
 * @param value exact located field
 * @returns exact stored excerpt
 */
export function excerpt(value: CanonicalJson): string {
  return typeof value === 'string' ? value : canonicalJson(value);
}

/**
 * pins one exact field value to its RFC 6901 location
 * @param context immutable captured source and located value
 * @returns a located stored citation
 */
export function createCitation(
  context: CitationContext,
): MappedObject['draft']['citations'][number] {
  const { snapshot, source, fieldPath, value } = context;

  return {
    id: stableId(`${source.versionId}:citation:${fieldPath}`),
    relation: 'supports',
    availability: 'stored',
    verification: 'located',
    quote: excerpt(value),
    source,
    locator: {
      id: stableId(`${source.versionId}:locator:${fieldPath}`),
      kind: 'structured',
      sourceId: source.id,
      sourceVersionId: source.versionId,
      provider: snapshot.provider,
      objectId: snapshot.objectId,
      fieldPath,
      valueHash: hash(canonicalJson(value)),
      url: snapshot.sourcePageUrl,
      retrievedAt: snapshot.retrievedAt,
      excerpt: excerpt(value),
    },
  };
}
