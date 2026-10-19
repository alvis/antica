import { canonicalJson } from './knowledge/canonical.js';

import type { KnowledgeContentEnvelopeV2 } from '@antica/contracts';

import type { Prisma } from '../generated/client.js';
import type { Transaction } from '../transaction.js';

const citationInclude = {
  sourceLocators: {
    include: {
      sourceVersions: { include: { externalObject: true } },
      sourceRegions: true,
      sourceBlocks: true,
    },
  },
} satisfies Prisma.citationsInclude;

type CitationRow = Prisma.citationsGetPayload<{
  include: typeof citationInclude;
}>;

/**
 * groups citation evidence reads for one corpus revision inside its transaction
 *
 * the returned transaction is private to the immediately awaited KDB06 write
 * path; only its exact citation validation queries use these immutable rows
 * ownership predicates are applied by PostgreSQL and every KDB06 metadata,
 * evidence, variant, image and association check still runs
 * @param tx transaction that will append the revision
 * @param ownerId owner required throughout the source chain
 * @param content envelope whose citation identities should be preloaded
 * @returns transaction with an exact-query citation read cache
 */
export async function preloadCorpusReferences(
  tx: Transaction,
  ownerId: string,
  content: KnowledgeContentEnvelopeV2,
): Promise<Transaction> {
  const rows = await tx.citations.findMany({
    where: {
      id: { in: content.citations.map((citation) => citation.id) },
      sourceLocators: {
        sources: { ownerId },
        sourceVersions: { ownerId },
      },
    },
    include: citationInclude,
  });
  const cached = new Map(
    rows.map((row) => [canonicalJson(citationQuery(row, ownerId)), row]),
  );
  const citations = new Proxy(tx.citations, {
    /**
     * forwards citation operations except the exact preloaded validation read
     * @param target original citation delegate
     * @param property requested delegate member
     * @returns cached read capability or unchanged delegate member
     */
    get(target, property): unknown {
      if (property !== 'findFirst') {
        return Reflect.get(target, property);
      }

      return async (args?: Prisma.citationsFindFirstArgs): Promise<unknown> => {
        const row = cached.get(canonicalJson(args));

        return row ? Promise.resolve(row) : target.findFirst(args);
      };
    },
  });

  return new Proxy(tx, {
    /**
     * preserves all transaction operations outside citation reads
     * @param target original transaction
     * @param property requested transaction member
     * @returns citation read adapter or unchanged transaction member
     */
    get(target, property): unknown {
      return property === 'citations'
        ? citations
        : Reflect.get(target, property);
    },
  });
}

/**
 * reconstructs only the exact query satisfied by an owner-filtered stored row
 * @param row immutable stored citation and its complete evidence chain
 * @param ownerId owner already enforced by the grouped database lookup
 * @returns KDB06 validation query with independently pinned source identities
 */
function citationQuery(
  row: CitationRow,
  ownerId: string,
): Prisma.citationsFindFirstArgs {
  return {
    where: {
      id: row.id,
      sourceLocators: {
        id: row.sourceLocators.id,
        sourceId: row.sourceLocators.sourceId,
        sourceVersionId: row.sourceLocators.sourceVersionId,
        sources: { ownerId },
        sourceVersions: {
          ownerId,
          sourceId: row.sourceLocators.sourceVersions.sourceId,
        },
      },
    },
    include: citationInclude,
  };
}
