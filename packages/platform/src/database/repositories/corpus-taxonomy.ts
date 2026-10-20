import { corpusId } from './corpus-identity.js';

import type { CorpusInstallRequest } from '@antica/application/ports';

import type { Transaction } from '../transaction.js';

import type { CorpusContent } from './corpus-content.js';

/**
 * installs taxonomy identities, preserved labels and pending authority evidence in bulk
 * @param tx batch transaction
 * @param request validated owner installation
 * @param content deterministic snapshot identities
 */
export async function installCorpusTaxonomy(
  tx: Transaction,
  request: CorpusInstallRequest,
  content: CorpusContent,
): Promise<void> {
  const { ownerId, topics } = request;
  await tx.topic.createMany({
    data: topics.map((topic) => ({
      id: corpusId(ownerId, topic.id),
      ownerId,
      contentId: topic.id,
      facet: topic.facet,
      parentId: topic.parentId ? corpusId(ownerId, topic.parentId) : null,
      sortOrder: topic.sortOrder,
    })),
    skipDuplicates: true,
  });
  await tx.topicLabel.createMany({
    data: topics.flatMap((topic) =>
      topic.labels.map((label) => ({
        id: corpusId(
          ownerId,
          `${topic.id}:${label.language}:${label.kind}:${label.text}`,
        ),
        ownerId,
        topicId: corpusId(ownerId, topic.id),
        ...label,
        normalizedText: label.text.normalize('NFKC').toLowerCase(),
      })),
    ),
    skipDuplicates: true,
  });
  const relations = topics.flatMap((topic) =>
    topic.relatedIds.map((id) => {
      const [fromTopicId, toTopicId] = [
        corpusId(ownerId, topic.id),
        corpusId(ownerId, id),
      ].sort();

      return {
        ownerId,
        fromTopicId: fromTopicId!,
        toTopicId: toTopicId!,
        relation: 'related' as const,
      };
    }),
  );
  if (relations.length) {
    await tx.topicRelation.createMany({
      data: relations,
      skipDuplicates: true,
    });
  }
  await writeMappings(tx, request, content);
}

/**
 * retains authority assignments as pending, independently of editorial release review
 * @param tx taxonomy transaction
 * @param request validated owner corpus
 * @param content pinned citation identities
 */
async function writeMappings(
  tx: Transaction,
  request: CorpusInstallRequest,
  content: CorpusContent,
): Promise<void> {
  const { ownerId, topics, sources } = request;
  const mappings = topics.flatMap((topic) =>
    topic.mappings.map((mapping) => {
      const source = sources.find((source) =>
        source.citations.some((citation) => citation.id === mapping.citationId),
      )!;

      return {
        id: corpusId(
          ownerId,
          `${topic.id}:${mapping.authority}:${mapping.authorityId}:${mapping.relation}`,
        ),
        ownerId,
        topicId: corpusId(ownerId, topic.id),
        authority: mapping.authority,
        authorityId: mapping.authorityId,
        uri: mapping.uri,
        relation: mapping.relation,
        authorityVersion: mapping.authorityVersion,
        retrievedAt: new Date(source.retrievedAt),
        citationId: content.childId(source, mapping.citationId),
        reviewState: 'pending' as const,
      };
    }),
  );
  if (mappings.length) {
    await tx.authorityMapping.createMany({
      data: mappings,
      skipDuplicates: true,
    });
  }
}
