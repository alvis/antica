import { requestFingerprint } from './receipt.js';

import type {
  CursorPage,
  KnowledgeDetail,
  KnowledgeQuery,
  KnowledgeSummary,
  KnowledgeUpdate,
  KnowledgeWrite,
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
  create(
    ownerId: string,
    input: KnowledgeWrite,
  ): Promise<OperationResult<KnowledgeDetail>>;
  update(
    ownerId: string,
    id: string,
    input: KnowledgeUpdate,
  ): Promise<OperationResult<KnowledgeDetail>>;
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
            savedBy: 'collector',
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
            savedBy: 'collector',
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
  };
}

/**
 * Resolves every submitted citation and support marker before saving a revision.
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
 * Lists the method statements that require citation validation.
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
 * Creates a public knowledge operation failure with retryability from its code.
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
