import { createHash } from 'node:crypto';

import { requestFingerprint } from './receipt.js';

import type {
  CursorPage,
  KnowledgeDetail,
  KnowledgeEntryDetailV2,
  KnowledgeQuery,
  KnowledgeReadV2,
  KnowledgeSummary,
  KnowledgeUpdate,
  KnowledgeUpdateV2,
  KnowledgeWrite,
  KnowledgeWriteV2,
  KnowledgeContentEnvelopeV2,
} from '@antica/contracts';
import type {
  CitedText,
  InspectionMethod,
  InspectionMethodVersion,
  KnowledgeEntry,
  MethodDefinition,
  SourceCitation,
} from '@antica/domain';

import type {
  ClockPort,
  IdPort,
  OperationResult,
  TransactionPort,
  UnitOfWork,
} from '../ports/index.js';

/** authenticated knowledge entry reads and collector revisions */
export interface KnowledgeService {
  list(
    ownerId: string,
    query: KnowledgeQuery,
  ): Promise<OperationResult<CursorPage<KnowledgeSummary>>>;
  get(
    ownerId: string,
    id: string,
    revision?: number,
    methodVersionId?: string,
  ): Promise<OperationResult<KnowledgeDetail>>;
  getV2(
    ownerId: string,
    id: string,
    read: KnowledgeReadV2,
  ): Promise<OperationResult<KnowledgeViewResult>>;
  create(
    ownerId: string,
    input: KnowledgeWrite,
  ): Promise<OperationResult<KnowledgeDetail>>;
  update(
    ownerId: string,
    id: string,
    input: KnowledgeUpdate,
  ): Promise<OperationResult<KnowledgeDetail>>;
  createV2(
    ownerId: string,
    input: KnowledgeWriteV2,
  ): Promise<OperationResult<KnowledgeEntryDetailV2>>;
  updateV2(
    ownerId: string,
    id: string,
    input: KnowledgeUpdateV2,
  ): Promise<OperationResult<KnowledgeEntryDetailV2>>;
}

/** exact revision response and its persisted envelope hash */
export interface KnowledgeViewResult {
  readonly detail: KnowledgeDetail | KnowledgeEntryDetailV2;
  readonly contentHash: string;
}

interface KnowledgeRevisionV2Params {
  readonly entryId: string;
  readonly content: KnowledgeContentEnvelopeV2;
  readonly status: 'draft' | 'saved';
  readonly savedBy: 'collector' | null;
  readonly reviewedBy: string | null;
  readonly reviewedAt: Date | null;
}

interface KnowledgeCreateV2Params extends KnowledgeRevisionV2Params {
  readonly displayCode: string;
}

interface KnowledgeUpdateV2Params extends KnowledgeRevisionV2Params {
  readonly expectedRevision: number;
}

interface KnowledgeRepositoryV2 {
  getV2(
    id: string,
    read: KnowledgeReadV2,
  ): Promise<KnowledgeDetail | KnowledgeEntryDetailV2 | null>;
  getV2Hash(id: string, read: KnowledgeReadV2): Promise<string | null>;
  createV2(params: KnowledgeCreateV2Params): Promise<KnowledgeEntryDetailV2>;
  validateV2References(content: KnowledgeContentEnvelopeV2): Promise<boolean>;
  addRevisionV2(
    params: KnowledgeUpdateV2Params,
  ): Promise<KnowledgeEntryDetailV2 | null>;
}

/**
 * creates collector-controlled knowledge revisions and pinned method versions
 * @param transaction collector-scoped unit of work
 * @param clock server clock
 * @param ids server identifier generator
 * @returns collector revision operations bound to persistent repositories
 */
export function createKnowledgeService(
  transaction: TransactionPort,
  clock: ClockPort,
  ids: IdPort,
): KnowledgeService {
  return {
    list: async (ownerId, query) =>
      transaction.run<OperationResult<CursorPage<KnowledgeSummary>>>(
        ownerId,
        async (unit) => ({
          success: true,
          data: await unit.knowledge.query(query),
        }),
      ),
    get: async (ownerId, id, revision, methodVersionId) =>
      transaction.run<OperationResult<KnowledgeDetail>>(
        ownerId,
        async (unit) => {
          const detail = await unit.knowledge.get(
            id,
            revision,
            methodVersionId,
          );

          return detail
            ? { success: true, data: detail }
            : failure(
                'NOT_FOUND',
                'Knowledge entry or requested version not found',
              );
        },
      ),
    getV2: async (ownerId, id, read) =>
      transaction.run<OperationResult<KnowledgeViewResult>>(
        ownerId,
        async (unit) => {
          const repository = v2Repository(unit);
          const detail = await repository.getV2(id, read);
          if (!detail) {
            return failure(
              'NOT_FOUND',
              'Knowledge entry or revision not found',
            );
          }
          const revision =
            'entry' in detail ? detail.entry.revision : detail.revision;
          const contentHash = await repository.getV2Hash(id, {
            view: 'revision',
            revision,
          });

          return contentHash
            ? { success: true, data: { detail, contentHash } }
            : failure('NOT_FOUND', 'Knowledge entry or revision not found');
        },
      ),
    create: async (ownerId, input) =>
      transaction.run<OperationResult<KnowledgeDetail>>(
        ownerId,
        async (unit) => {
          const fingerprint = requestFingerprint(input);
          const prior = await unit.commands.get(
            ownerId,
            'knowledge.create',
            input.requestKey,
          );
          if (prior) {
            return prior.fingerprint === fingerprint
              ? { success: true, data: prior.result as KnowledgeDetail }
              : failure(
                  'VALIDATION_FAILED',
                  'Idempotency key was used for different knowledge content',
                );
          }
          const validated = await validateKnowledgeInput(unit, input);
          if (!validated.success) {
            return validated;
          }
          const entryId = ids.create();
          const now = clock.now();
          const methodIds = [
            ...input.linkedMethodIds,
            ...input.methodWrites.map(
              (write) => write.methodId ?? ids.create(),
            ),
          ];
          if (new Set(methodIds).size !== methodIds.length) {
            return failure(
              'VALIDATION_FAILED',
              'Method identifiers must be distinct',
            );
          }
          const entry: KnowledgeEntry = {
            id: entryId,
            revision: 1,
            createdAt: now,
            updatedAt: now,
            displayCode: await unit.knowledge.allocateCode(),
            status: input.status,
            content: input.content,
            methodIds,
            savedBy: input.status === 'saved' ? 'collector' : null,
          };
          await unit.knowledge.create(entry);
          const versions: InspectionMethodVersion[] = [];
          for (const [index, write] of input.methodWrites.entries()) {
            if (write.methodId) {
              return failure(
                'VALIDATION_FAILED',
                'New knowledge entries cannot update an existing method',
              );
            }
            const methodId = methodIds[input.linkedMethodIds.length + index]!;
            const version: InspectionMethodVersion = {
              id: ids.create(),
              methodId,
              revision: 1,
              definition: write.definition,
              createdAt: now,
            };
            const method: InspectionMethod = {
              id: methodId,
              owningEntryId: entryId,
              currentVersionId: version.id,
            };
            await unit.knowledge.createMethod(method, version);
            versions.push(version);
          }
          for (const methodId of input.linkedMethodIds) {
            const method = await unit.knowledge.getMethod(methodId);
            if (!method) {
              return failure(
                'SOURCE_UNAVAILABLE',
                'Linked inspection method not found',
              );
            }
            const version = await unit.knowledge.getMethodVersion(
              method.currentVersionId,
            );
            if (!version) {
              return failure(
                'SOURCE_UNAVAILABLE',
                'Linked inspection method version not found',
              );
            }
            versions.push(version);
          }
          await unit.knowledge.linkMethods(
            entryId,
            1,
            versions.map((version) => version.id),
          );
          const detail = await unit.knowledge.get(entryId);
          if (!detail) {
            return failure(
              'NOT_FOUND',
              'Knowledge entry could not be read after creation',
            );
          }
          await unit.commands.insert({
            ownerId,
            operation: 'knowledge.create',
            requestKey: input.requestKey,
            fingerprint,
            status: 201,
            result: detail,
          });

          return { success: true, data: detail };
        },
      ),
    update: async (ownerId, id, input) =>
      transaction.run<OperationResult<KnowledgeDetail>>(
        ownerId,
        async (unit) => {
          const fingerprint = requestFingerprint({ id, input });
          const prior = await unit.commands.get(
            ownerId,
            'knowledge.update',
            input.requestKey,
          );
          if (prior) {
            return prior.fingerprint === fingerprint
              ? { success: true, data: prior.result as KnowledgeDetail }
              : failure(
                  'VALIDATION_FAILED',
                  'Idempotency key was used for different knowledge content',
                );
          }
          const current = await unit.knowledge.get(id);
          if (!current) {
            return failure('NOT_FOUND', 'Knowledge entry not found');
          }
          if (current.entry.revision !== input.expectedRevision) {
            return failure(
              'REVISION_CONFLICT',
              'Knowledge entry changed since it was opened',
            );
          }
          const validated = await validateKnowledgeInput(unit, input);
          if (!validated.success) {
            return validated;
          }
          const now = clock.now();
          const methodIds = [
            ...input.linkedMethodIds,
            ...input.methodWrites.map(
              (write) => write.methodId ?? ids.create(),
            ),
          ];
          if (new Set(methodIds).size !== methodIds.length) {
            return failure(
              'VALIDATION_FAILED',
              'Method identifiers must be distinct',
            );
          }
          const entry: KnowledgeEntry = {
            ...current.entry,
            revision: current.entry.revision + 1,
            updatedAt: now,
            status: input.status,
            content: input.content,
            methodIds,
            savedBy: input.status === 'saved' ? 'collector' : null,
          };
          if (
            !(await unit.knowledge.addRevision(entry, current.entry.revision))
          ) {
            return failure(
              'REVISION_CONFLICT',
              'Knowledge entry changed during update',
            );
          }
          const versions: InspectionMethodVersion[] = [];
          for (const [index, write] of input.methodWrites.entries()) {
            const methodId = methodIds[input.linkedMethodIds.length + index]!;
            if (write.methodId) {
              const method = await unit.knowledge.getMethod(methodId);
              const previous = write.expectedVersionId
                ? await unit.knowledge.getMethodVersion(write.expectedVersionId)
                : null;
              if (
                !method ||
                method.owningEntryId !== id ||
                !previous ||
                previous.methodId !== methodId
              ) {
                return failure(
                  'VALIDATION_FAILED',
                  'Method is not owned by this entry',
                );
              }
              if (method.currentVersionId !== write.expectedVersionId) {
                return failure(
                  'REVISION_CONFLICT',
                  'Inspection method changed since it was opened',
                );
              }
              const version: InspectionMethodVersion = {
                id: ids.create(),
                methodId,
                revision: previous.revision + 1,
                definition: write.definition,
                createdAt: now,
              };
              if (
                !(await unit.knowledge.addMethodVersion(
                  methodId,
                  write.expectedVersionId,
                  version,
                ))
              ) {
                return failure(
                  'REVISION_CONFLICT',
                  'Inspection method changed during update',
                );
              }
              versions.push(version);
            } else {
              const version: InspectionMethodVersion = {
                id: ids.create(),
                methodId,
                revision: 1,
                definition: write.definition,
                createdAt: now,
              };
              await unit.knowledge.createMethod(
                {
                  id: methodId,
                  owningEntryId: id,
                  currentVersionId: version.id,
                },
                version,
              );
              versions.push(version);
            }
          }
          for (const methodId of input.linkedMethodIds) {
            const method = await unit.knowledge.getMethod(methodId);
            if (!method) {
              return failure(
                'SOURCE_UNAVAILABLE',
                'Linked inspection method not found',
              );
            }
            const version = await unit.knowledge.getMethodVersion(
              method.currentVersionId,
            );
            if (!version) {
              return failure(
                'SOURCE_UNAVAILABLE',
                'Linked inspection method version not found',
              );
            }
            versions.push(version);
          }
          await unit.knowledge.linkMethods(
            id,
            entry.revision,
            versions.map((version) => version.id),
          );
          const detail = await unit.knowledge.get(id);
          if (!detail) {
            return failure(
              'NOT_FOUND',
              'Knowledge entry could not be read after update',
            );
          }
          await unit.commands.insert({
            ownerId,
            operation: 'knowledge.update',
            requestKey: input.requestKey,
            fingerprint,
            status: 200,
            result: detail,
          });

          return { success: true, data: detail };
        },
      ),
    createV2: async (ownerId, input) =>
      transaction.run<OperationResult<KnowledgeEntryDetailV2>>(
        ownerId,
        async (unit) => {
          const fingerprint = requestFingerprint(input);
          const prior = await unit.commands.get(
            ownerId,
            'knowledge.create.v2',
            input.requestKey,
          );
          if (prior) {
            return prior.fingerprint === fingerprint
              ? { success: true, data: prior.result as KnowledgeEntryDetailV2 }
              : failure(
                  'VALIDATION_FAILED',
                  'Idempotency key was used for different knowledge content',
                );
          }
          const prepared = await prepareV2Revision({
            repository: v2Repository(unit),
            actor: ownerId,
            at: clock.now(),
            input,
          });
          if (!prepared.success) {
            return prepared;
          }
          const { content, reviewed } = prepared.data;
          const detail = await v2Repository(unit).createV2({
            entryId: ids.create(),
            displayCode: await unit.knowledge.allocateCode(),
            content,
            status: input.status,
            savedBy: input.status === 'saved' ? 'collector' : null,
            reviewedBy: reviewed.by,
            reviewedAt: reviewed.at,
          });
          await unit.commands.insert({
            ownerId,
            operation: 'knowledge.create.v2',
            requestKey: input.requestKey,
            fingerprint,
            status: 201,
            result: detail,
          });

          return { success: true, data: detail };
        },
      ),
    updateV2: async (ownerId, id, input) =>
      transaction.run<OperationResult<KnowledgeEntryDetailV2>>(
        ownerId,
        async (unit) => {
          const repository = v2Repository(unit);
          const fingerprint = requestFingerprint({ id, input });
          const prior = await unit.commands.get(
            ownerId,
            'knowledge.update.v2',
            input.requestKey,
          );
          if (prior) {
            return prior.fingerprint === fingerprint
              ? { success: true, data: prior.result as KnowledgeEntryDetailV2 }
              : failure(
                  'VALIDATION_FAILED',
                  'Idempotency key was used for different knowledge content',
                );
          }
          const revision = input.expectedRevision;
          const expected = await checkV2Revision(repository, id, revision);
          if (!expected.success) {
            return expected;
          }
          const actor = ownerId;
          const at = clock.now();
          const params = { repository, actor, at, input };
          const prepared = await prepareV2Revision(params);
          if (!prepared.success) {
            return prepared;
          }
          const { content, reviewed } = prepared.data;
          const detail = await repository.addRevisionV2({
            entryId: id,
            expectedRevision: input.expectedRevision,
            content,
            status: input.status,
            savedBy: input.status === 'saved' ? 'collector' : null,
            reviewedBy: reviewed.by,
            reviewedAt: reviewed.at,
          });
          if (!detail) {
            return failure(
              'REVISION_CONFLICT',
              'Knowledge entry changed since it was opened',
            );
          }
          await unit.commands.insert({
            ownerId,
            operation: 'knowledge.update.v2',
            requestKey: input.requestKey,
            fingerprint,
            status: 200,
            result: detail,
          });

          return { success: true, data: detail };
        },
      ),
  };
}

interface V2ReviewMetadata {
  readonly by: string | null;
  readonly at: Date | null;
}

interface PreparedV2Revision {
  readonly content: KnowledgeContentEnvelopeV2;
  readonly reviewed: V2ReviewMetadata;
}

interface PrepareV2RevisionParams {
  readonly repository: KnowledgeRepositoryV2;
  readonly actor: string;
  readonly at: string;
  readonly input: KnowledgeWriteV2 | KnowledgeUpdateV2;
}

/**
 * Returns the v2 extension implemented by the persistent repository.
 * @param unit owner-scoped unit of work
 * @returns v2 knowledge repository
 */
function v2Repository(unit: UnitOfWork): KnowledgeRepositoryV2 {
  return unit.knowledge as typeof unit.knowledge & KnowledgeRepositoryV2;
}

/**
 * Applies client decisions while assigning trusted server review metadata.
 * @param actor authenticated reviewer identifier
 * @param at trusted server review time
 * @param input submitted v2 revision
 * @returns canonical content with server-assigned reviews
 */
function applyReviewDecisions(
  actor: string,
  at: string,
  input: KnowledgeWriteV2 | KnowledgeUpdateV2,
): KnowledgeContentEnvelopeV2 {
  const claimDecisions = new Map(
    input.reviewDecisions.map((decision) => [
      decision.claimKey,
      decision.state,
    ]),
  );
  const translationDecisions = new Map(
    input.translationDecisions.map((decision) => [
      `${decision.claimKey}\u0000${decision.language}`,
      decision.state,
    ]),
  );
  const reviewedAt = at;

  return {
    ...input.content,
    claims: input.content.claims.map((claim) => ({
      ...claim,
      review: assignedReview(
        claimDecisions.get(claim.claimKey) ?? claim.review.state,
        actor,
        reviewedAt,
      ),
      variants: claim.variants.map((variant) => ({
        ...variant,
        review:
          variant.sourceTextHash !== textHash(claim.originalText)
            ? { state: 'pending' as const }
            : assignedReview(
                translationDecisions.get(
                  `${claim.claimKey}\u0000${variant.language}`,
                ) ?? variant.review.state,
                actor,
                reviewedAt,
              ),
      })),
    })),
    editorialReview: assignedReview(
      input.content.editorialReview.state,
      actor,
      reviewedAt,
    ),
  };
}

/**
 * Rejects duplicate, unknown, or stale granular review decisions.
 * @param input submitted v2 revision
 * @returns validation result
 */
function validateV2Decisions(
  input: KnowledgeWriteV2 | KnowledgeUpdateV2,
): OperationResult<void> {
  const claims = new Map(
    input.content.claims.map((claim) => [claim.claimKey, claim]),
  );
  if (
    new Set(input.reviewDecisions.map((decision) => decision.claimKey)).size !==
      input.reviewDecisions.length ||
    input.reviewDecisions.some((decision) => !claims.has(decision.claimKey))
  ) {
    return failure(
      'VALIDATION_FAILED',
      'Review decision claim was not supplied',
    );
  }
  const translationIdentities = input.translationDecisions.map(
    (decision) => `${decision.claimKey}\u0000${decision.language}`,
  );
  if (new Set(translationIdentities).size !== translationIdentities.length) {
    return failure(
      'VALIDATION_FAILED',
      'Translation decisions must identify distinct variants',
    );
  }
  for (const decision of input.translationDecisions) {
    const claim = claims.get(decision.claimKey);
    const variant = claim?.variants.find(
      (candidate) =>
        candidate.kind === decision.kind &&
        candidate.language === decision.language,
    );
    if (!claim || !variant) {
      return failure(
        'VALIDATION_FAILED',
        'Translation decision variant was not supplied',
      );
    }
    if (variant.sourceTextHash !== textHash(claim.originalText)) {
      return failure(
        'VALIDATION_FAILED',
        'Changed source text invalidates its translation review',
      );
    }
  }

  return { success: true, data: undefined };
}

/**
 * Builds review metadata without accepting client actor or time fields.
 * @param state requested review state
 * @param actor authenticated reviewer identifier
 * @param at trusted server review time
 * @returns canonical review metadata
 */
function assignedReview(
  state: 'pending' | 'reviewed' | 'rejected',
  actor: string,
  at: string,
): KnowledgeContentEnvelopeV2['editorialReview'] {
  return state === 'pending' ? { state } : { state, actor, at };
}

/**
 * Validates claim, node, and citation consistency before persistence.
 * @param content canonical v2 content
 * @returns validation result
 */
function validateV2Content(
  content: KnowledgeContentEnvelopeV2,
): OperationResult<void> {
  const claims = new Map(
    content.claims.map((claim) => [claim.claimKey, claim]),
  );
  const citations = new Map(
    content.citations.map((citation) => [citation.id, citation]),
  );
  const citedNodes = positionedV2Nodes(content);
  if (
    claims.size !== content.claims.length ||
    citedNodes.some(({ node, section, ordinal }) => {
      const claim = claims.get(node.claimKey);
      if (!claim) {
        return true;
      }

      return (
        claim.section !== section ||
        claim.ordinal !== ordinal ||
        claim.originalText !== node.text ||
        claim.supportState !== node.supportState ||
        requestFingerprint(claim.citationIds) !==
          requestFingerprint(node.citationIds)
      );
    })
  ) {
    return failure(
      'VALIDATION_FAILED',
      'Every cited section must identify one distinct claim',
    );
  }
  for (const claim of content.claims) {
    if (claim.citationIds.some((id) => !citations.has(id))) {
      return failure('SOURCE_UNAVAILABLE', 'Claim citation was not supplied');
    }
    if (
      claim.supportState === 'cited' &&
      !claim.citationIds.some((id) => {
        const citation = citations.get(id);

        return (
          citation?.relation === 'supports' &&
          citation.verification === 'located'
        );
      })
    ) {
      return failure(
        'VALIDATION_FAILED',
        'Cited claims need a located supporting citation',
      );
    }
  }

  return { success: true, data: undefined };
}

/**
 * Returns the canonical hash used to detect stale translations.
 * @param text source claim text
 * @returns lowercase SHA-256 digest
 */
function textHash(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/**
 * Converts persisted editorial review metadata to repository columns.
 * @param content canonical v2 content
 * @returns normalized review columns
 */
function reviewMetadata(content: KnowledgeContentEnvelopeV2): V2ReviewMetadata {
  const review = content.editorialReview;

  return {
    by: review.actor ?? null,
    at: review.at ? new Date(review.at) : null,
  };
}

/**
 * Returns content nodes with their canonical claim positions.
 * @param content canonical v2 content
 * @returns positioned cited nodes
 */
function positionedV2Nodes(content: KnowledgeContentEnvelopeV2): ReadonlyArray<{
  readonly node: KnowledgeContentEnvelopeV2['sections']['summary'];
  readonly section: string;
  readonly ordinal: number;
}> {
  const nodes = (
    section: 'history' | 'features' | 'applicability' | 'limits',
  ): ReadonlyArray<{
    node: KnowledgeContentEnvelopeV2['sections']['summary'];
    section: string;
    ordinal: number;
  }> =>
    content.sections[section].map((node, ordinal) => ({
      node,
      section,
      ordinal,
    }));

  return [
    { node: content.sections.summary, section: 'summary', ordinal: 0 },
    ...nodes('history'),
    ...nodes('features'),
    ...nodes('applicability'),
    ...nodes('limits'),
  ];
}

/**
 * Validates and canonicalizes a v2 revision before persistence.
 * @param params trusted inputs and owner-scoped repository
 * @returns prepared content and review columns
 */
async function prepareV2Revision(
  params: PrepareV2RevisionParams,
): Promise<OperationResult<PreparedV2Revision>> {
  const { repository, actor, at, input } = params;
  const decisions = validateV2Decisions(input);
  if (!decisions.success) {
    return decisions;
  }
  const content = applyReviewDecisions(actor, at, input);
  const validation = validateV2Content(content);
  if (!validation.success) {
    return validation;
  }
  if (!(await repository.validateV2References(content))) {
    return failure(
      'SOURCE_UNAVAILABLE',
      'Knowledge evidence is unavailable to this owner',
    );
  }

  return {
    success: true,
    data: { content, reviewed: reviewMetadata(content) },
  };
}

/**
 * Confirms that an update targets the current working revision.
 * @param repository owner-scoped v2 repository
 * @param id knowledge entry identifier
 * @param expectedRevision client revision precondition
 * @returns success when the working revision matches
 */
async function checkV2Revision(
  repository: KnowledgeRepositoryV2,
  id: string,
  expectedRevision: number,
): Promise<OperationResult<void>> {
  const current = await repository.getV2(id, { view: 'working' });
  if (!current) {
    return failure('NOT_FOUND', 'Knowledge entry not found');
  }
  const revision =
    'entry' in current ? current.entry.revision : current.revision;

  return revision === expectedRevision
    ? { success: true, data: undefined }
    : failure(
        'REVISION_CONFLICT',
        'Knowledge entry changed since it was opened',
      );
}

/**
 * resolves every submitted citation and support marker before saving a revision
 * @param unit owner-scoped source and research repositories
 * @param input requested entry content and method definitions
 * @returns success only when citations still match their stored originals
 */
async function validateKnowledgeInput(
  unit: UnitOfWork,
  input: KnowledgeWrite,
): Promise<OperationResult<void>> {
  if (!input.content.titleZhHant.trim() || input.content.kinds.length === 0) {
    return failure(
      'VALIDATION_FAILED',
      'Knowledge entry needs a title and kind',
    );
  }
  if (
    input.originResearchId &&
    !(await unit.research.get(input.originResearchId))
  ) {
    return failure('SOURCE_UNAVAILABLE', 'Origin research not found');
  }
  const citations = [
    ...input.content.citations,
    ...input.methodWrites.flatMap((write) => write.definition.citations),
  ];
  const citedById = new Map<string, SourceCitation>();
  for (const citation of citations) {
    const stored = await unit.sources.getCitation(citation.id);
    if (
      !stored ||
      requestFingerprint(stored) !== requestFingerprint(citation)
    ) {
      return failure(
        'SOURCE_UNAVAILABLE',
        'Citation no longer resolves to its original source',
      );
    }
    citedById.set(citation.id, citation);
  }
  const sections: CitedText[] = [
    input.content.summary,
    ...input.content.history,
    ...input.content.features,
    ...input.content.applicability.map((context) => context.limits),
    ...input.methodWrites.flatMap((write) => citedSections(write.definition)),
  ];
  for (const section of sections) {
    if (
      section.support === 'cited' &&
      (section.citationIds.length === 0 ||
        section.citationIds.some((id) => !citedById.has(id)))
    ) {
      return failure(
        'VALIDATION_FAILED',
        'Cited content must resolve to a supplied source citation',
      );
    }
    if (
      section.support === 'needs_source' &&
      section.citationIds.length > 0 &&
      section.citationIds.some((id) => !citedById.has(id))
    ) {
      return failure(
        'VALIDATION_FAILED',
        'Source citation identifier is missing',
      );
    }
  }

  return { success: true, data: undefined };
}

/**
 * lists the method statements that require citation validation
 * @param definition inspection method content
 * @returns history, applicability limits and interpretation limits
 */
function citedSections(definition: MethodDefinition): readonly CitedText[] {
  return [
    ...definition.history,
    ...definition.applicability.map((context) => context.limits),
    ...definition.interpretationLimits,
  ];
}

/**
 * creates a public knowledge operation failure with retryability from its code
 * @param code public failure category
 * @param message safe user-facing explanation
 * @returns failed operation result
 */
function failure(
  code:
    | 'VALIDATION_FAILED'
    | 'SOURCE_UNAVAILABLE'
    | 'NOT_FOUND'
    | 'REVISION_CONFLICT',
  message: string,
): OperationResult<never> {
  return {
    success: false,
    error: { code, message, retryable: code === 'REVISION_CONFLICT' },
  };
}
