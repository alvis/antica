import { createHash } from 'node:crypto';

import {
  answerSegmentSchema,
  knowledgeAttachmentSchema,
  knowledgeEvidenceSnapshotV1Schema,
  knowledgeEvidenceTextBytes,
} from '@antica/contracts';

import type {
  AnswerSegment,
  KnowledgeAttachment,
  KnowledgeDetail,
  KnowledgeEntryDetailV2,
  KnowledgeEvidenceSnapshotV1,
  KnowledgeReadV2,
  RelatedKnowledgePage,
  RelatedKnowledgeQuery,
} from '@antica/contracts';

import type { OperationResult } from '../ports/index.js';

/** Owner-scoped reads performed in the message's existing transaction. */
export interface KnowledgeEvidenceReader {
  related(
    recordId: string,
    query: RelatedKnowledgeQuery,
  ): Promise<RelatedKnowledgePage | null>;
  getV2(
    id: string,
    read: KnowledgeReadV2,
  ): Promise<KnowledgeEntryDetailV2 | KnowledgeDetail | null>;
  getCorpusGeneration(): Promise<string>;
}
interface SnapshotInput {
  readonly snapshotId: string;
  readonly recordId: string;
  readonly recordRevision: number;
  readonly corpusGeneration: string;
  readonly entries: readonly KnowledgeEntryDetailV2[];
  readonly attachments: readonly KnowledgeAttachment[];
}
type FrozenEntry = KnowledgeEvidenceSnapshotV1['entries'][number];
type FrozenClaim = FrozenEntry['claims'][number];
type Claim = KnowledgeEntryDetailV2['content']['claims'][number];
type Citation = KnowledgeEntryDetailV2['content']['citations'][number];

/**
 * Resolves exact saved revisions once before the draft or model is created.
 * @param reader owner-scoped knowledge capabilities
 * @param record record revision already checked by the submit operation
 * @param record.id owner-scoped record identity
 * @param record.recordRevision expected record revision
 * @param attachments untrusted suggested evidence identities
 * @param snapshotId server-created immutable snapshot identity
 * @returns frozen admitted evidence or a typed rejection with no writes
 */
export async function freezeKnowledgeEvidence(
  reader: KnowledgeEvidenceReader,
  record: { readonly id: string; readonly recordRevision: number },
  attachments: readonly KnowledgeAttachment[],
  snapshotId: string,
): Promise<OperationResult<KnowledgeEvidenceSnapshotV1>> {
  const related = await reader.related(record.id, {
    locale: 'zh-Hant',
    limit: 3,
    recordRevision: record.recordRevision,
  });
  if (!related) {
    return failure('NOT_FOUND', 'Record not found');
  }
  if (related.recordRevision !== record.recordRevision) {
    return failure(
      'REVISION_CONFLICT',
      'Record changed before evidence was frozen',
    );
  }
  const identities = [...attachments, ...related.cards];
  const entries: KnowledgeEntryDetailV2[] = [];
  const seen = new Set<string>();
  for (const identity of identities) {
    const key = `${identity.entryId}:${identity.revision}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    const detail = await reader.getV2(identity.entryId, {
      view: 'revision',
      revision: identity.revision,
    });
    if (
      detail &&
      'content' in detail &&
      detail.id === identity.entryId &&
      detail.revision === identity.revision
    ) {
      entries.push(detail);
    }
  }

  return buildKnowledgeEvidenceSnapshot({
    snapshotId,
    recordId: record.id,
    recordRevision: record.recordRevision,
    corpusGeneration: await reader.getCorpusGeneration(),
    entries,
    attachments,
  });
}

/**
 * Admits complete reviewed claims, prioritizing validated explicit attachments.
 * @param input pinned saved envelopes and server snapshot context
 * @returns canonical bounded snapshot, never partially truncated claims
 */
export function buildKnowledgeEvidenceSnapshot(
  input: SnapshotInput,
): OperationResult<KnowledgeEvidenceSnapshotV1> {
  const eligible = new Map<string, FrozenEntry>();
  for (const entry of input.entries) {
    if (entry.status !== 'saved') {
      continue;
    }
    const claims = entry.content.claims.flatMap((claim) => {
      const frozen = freezeClaim(entry, claim);

      return frozen ? [frozen] : [];
    });
    eligible.set(`${entry.id}:${entry.revision}`, {
      entryId: entry.id,
      revision: entry.revision,
      contentHash: entry.contentHash,
      title: (
        entry.content.titles.find((title) => title.language === 'zh-Hant') ??
        entry.content.titles[0]!
      ).text,
      claims,
    });
  }
  if (input.attachments.length > 6) {
    return failure('EVIDENCE_INVALID', 'Too many knowledge attachments');
  }
  for (const attachment of input.attachments) {
    if (!knowledgeAttachmentSchema.safeParse(attachment).success) {
      return failure('EVIDENCE_INVALID', 'Invalid knowledge attachment');
    }
    const entry = eligible.get(`${attachment.entryId}:${attachment.revision}`);
    // Validate against all admitted citations before limiting each claim to three.
    const source = input.entries.find(
      (item) =>
        item.id === attachment.entryId && item.revision === attachment.revision,
    );
    const claim = source?.content.claims.find(
      (item) => item.claimKey === attachment.claimKey,
    );
    if (
      !entry ||
      !claim ||
      !entry.claims.some((item) => item.claimKey === attachment.claimKey) ||
      attachment.citationIds.some(
        (id) =>
          !supportingCitations(source!, claim).some(
            (citation) => citation.id === id,
          ),
      )
    ) {
      return failure(
        'EVIDENCE_INVALID',
        'Knowledge attachment is not saved, reviewed, cited evidence',
      );
    }
  }
  const entries: FrozenEntry[] = [];
  const selected = new Set<string>();
  const candidates = [
    ...input.attachments.map((attachment) => ({
      entry: eligible.get(`${attachment.entryId}:${attachment.revision}`)!,
      claimKey: attachment.claimKey,
      citationIds: attachment.citationIds,
    })),
    ...[...eligible.values()].flatMap((entry) =>
      entry.claims.map((claim) => ({
        entry,
        claimKey: claim.claimKey,
        citationIds: undefined,
      })),
    ),
  ];
  let count = 0;
  for (const candidate of candidates) {
    const { entry, claimKey } = candidate;
    const identity = `${entry.entryId}:${entry.revision}:${claimKey}`;
    if (selected.has(identity) || count === 6) {
      continue;
    }
    const existing = entries.find(
      (item) =>
        item.entryId === entry.entryId && item.revision === entry.revision,
    );
    if (!existing && entries.length === 3) {
      continue;
    }
    let claim = entry.claims.find((item) => item.claimKey === claimKey)!;
    if (candidate.citationIds) {
      const source = input.entries.find(
        (item) => item.id === entry.entryId && item.revision === entry.revision,
      )!;
      const original = source.content.claims.find(
        (item) => item.claimKey === claimKey,
      )!;
      const citations = supportingCitations(source, original)
        .filter((item) => candidate.citationIds.includes(item.id))
        .map(freezeCitation);
      claim = {
        ...claim,
        citations,
        sourceVersionIds: [
          ...new Set(citations.map((item) => item.sourceVersionId)),
        ],
      };
    }
    const next = existing
      ? entries.map((item) =>
          item === existing
            ? { ...item, claims: [...item.claims, claim] }
            : item,
        )
      : [...entries, { ...entry, claims: [claim] }];
    if (knowledgeEvidenceTextBytes(next) > 12_288) {
      continue;
    }
    entries.splice(0, entries.length, ...next);
    selected.add(identity);
    count += 1;
  }
  const semantic = {
    schemaVersion: 1 as const,
    recordId: input.recordId,
    recordRevision: input.recordRevision,
    corpusGeneration: input.corpusGeneration,
    entries,
  };
  const snapshot = knowledgeEvidenceSnapshotV1Schema.parse({
    ...semantic,
    snapshotId: input.snapshotId,
    snapshotHash: sha256(canonical(semantic)),
  });

  return { success: true, data: snapshot };
}

/**
 * Verifies every model reference against the frozen snapshot, without fetching current knowledge.
 * @param segments model-authored answer segments
 * @param snapshot authoritative immutable evidence
 * @returns whether all segments and reference identities are valid
 */
export function validateKnowledgeAnswerSegments(
  segments: readonly AnswerSegment[],
  snapshot: KnowledgeEvidenceSnapshotV1,
): boolean {
  const parsed = answerSegmentSchema.array().min(1).max(32).safeParse(segments);
  if (
    !parsed.success ||
    parsed.data.map((segment) => segment.text).join('\n').length > 4000
  ) {
    return false;
  }

  return parsed.data.every((segment) =>
    segment.evidenceRefs.every((ref) => {
      const entry = snapshot.entries.find(
        (item) =>
          item.entryId === ref.entryId && item.revision === ref.revision,
      );
      const claim = entry?.claims.find(
        (item) => item.claimKey === ref.claimKey,
      );

      return (
        claim !== undefined &&
        ref.citationIds.every((id) =>
          claim.citations.some((citation) => citation.citationId === id),
        )
      );
    }),
  );
}

/**
 * Selects only located supporting citations belonging to their pinned source version.
 * @param entry saved envelope
 * @param claim reviewed source claim
 * @returns located support citations
 */
function supportingCitations(
  entry: KnowledgeEntryDetailV2,
  claim: Claim,
): Citation[] {
  return entry.content.citations.filter(
    (citation) =>
      claim.citationIds.includes(citation.id) &&
      citation.relation === 'supports' &&
      citation.verification === 'located' &&
      citation.locator.sourceId === citation.source.id &&
      citation.locator.sourceVersionId === citation.source.versionId,
  );
}
/**
 * Preserves the full admitted claim, using only a reviewed current translation.
 * @param entry saved envelope
 * @param claim claim to admit
 * @returns complete frozen claim or null
 */
function freezeClaim(
  entry: KnowledgeEntryDetailV2,
  claim: Claim,
): FrozenClaim | null {
  if (claim.supportState !== 'cited' || claim.review.state !== 'reviewed') {
    return null;
  }
  const citations = supportingCitations(entry, claim)
    .slice(0, 3)
    .map(freezeCitation);
  if (citations.length === 0) {
    return null;
  }
  const translation = claim.variants.find(
    (variant) =>
      variant.kind === 'translation' &&
      variant.language === 'zh-Hant' &&
      variant.review.state === 'reviewed' &&
      variant.sourceTextHash === sha256(claim.originalText),
  );
  const identity = sha256(`${entry.id}:${entry.revision}:${claim.claimKey}`);

  return {
    claimId: `${identity.slice(0, 8)}-${identity.slice(8, 12)}-5${identity.slice(13, 16)}-a${identity.slice(17, 20)}-${identity.slice(20, 32)}`,
    claimKey: claim.claimKey,
    statement: translation?.text ?? claim.originalText,
    originalText: claim.originalText,
    language: translation?.language ?? claim.originalLanguage,
    scope: claim.scope,
    qualifiers: claim.qualifiers,
    ...(claim.uncertainty === undefined
      ? {}
      : { uncertainty: claim.uncertainty }),
    sourceVersionIds: [
      ...new Set(citations.map((citation) => citation.sourceVersionId)),
    ],
    citations,
  };
}
/**
 * Copies immutable display metadata without re-fetching its remote source.
 * @param citation immutable located source support
 * @returns display metadata and server reference IDs
 */
function freezeCitation(citation: Citation): FrozenClaim['citations'][number] {
  const locator = citation.locator;

  return {
    citationId: citation.id,
    sourceId: citation.source.id,
    sourceVersionId: citation.source.versionId,
    locatorId: locator.id,
    relation: 'supports',
    sourceTitle: citation.source.title,
    excerpt: locator.excerpt,
    ...(locator.kind === 'structured'
      ? {
          provider: locator.provider,
          objectId: locator.objectId,
          fieldPath: locator.fieldPath,
          sourcePageUrl: locator.url,
        }
      : {}),
    ...(locator.kind === 'web'
      ? {
          sourcePageUrl: locator.url,
          ...(locator.section === undefined
            ? {}
            : { section: locator.section }),
        }
      : {}),
    ...(locator.kind === 'page'
      ? {
          pageLabel: locator.printedPageLabel ?? String(locator.pageIndex + 1),
          ...(citation.source.canonicalUrl
            ? { sourcePageUrl: citation.source.canonicalUrl }
            : {}),
        }
      : {}),
  };
}
/**
 * Serializes semantic data with recursively sorted object keys.
 * @param value nested semantic data
 * @returns canonical JSON
 */
function canonical(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right, 'en'))
      .map(([name, child]) => `${JSON.stringify(name)}:${canonical(child)}`)
      .join(',')}}`;
  }

  return JSON.stringify(value);
}
/**
 * Hashes UTF-8 text for immutable evidence identities.
 * @param text source text
 * @returns SHA-256 lowercase hex
 */
function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}
/**
 * Describes an evidence rejection for the caller's existing transaction.
 * @param code public failure code
 * @param message explanation
 * @returns transactional rejection
 */
function failure(
  code: 'NOT_FOUND' | 'EVIDENCE_INVALID' | 'REVISION_CONFLICT',
  message: string,
): OperationResult<never> {
  return {
    success: false,
    error: { code, message, retryable: code === 'REVISION_CONFLICT' },
  };
}
