import { createCorpusContent } from './corpus-content.js';
import { corpusId } from './corpus-identity.js';
import { canonicalHash } from './knowledge/canonical.js';

import type {
  CorpusInstallDisposition,
  CorpusInstallPlan,
  CorpusInstallRequest,
} from '@antica/application/ports';

import type { Database } from '../connection.js';
import type {
  Prisma,
  CorpusInstallItem,
  knowledgeEntries,
} from '../generated/client.js';

import type { CorpusContent } from './corpus-content.js';

const maximumPayloadBytes = 262_144;
// PG16 query-event measurements include BEGIN, COMMIT and checkpoint writes.
const predictedBatchStatements = 30;
const predictedSetupStatements = 9;

/** prepared owner release, evidence identities and prior pinned receipt bases */
export interface PreparedInstall {
  readonly request: CorpusInstallRequest;
  readonly content: CorpusContent;
  readonly plan: CorpusInstallPlan;
  readonly prior: ReadonlyMap<string, CorpusInstallItem>;
  readonly releaseId: string;
}

/**
 * checks immutable releases and predicts dispositions without writing receipt rows
 * @param db database query capability
 * @param request validated owner release
 * @returns pinned installation context
 */
export async function inspectInstall(
  db: Database,
  request: CorpusInstallRequest,
): Promise<PreparedInstall> {
  validateRequest(request);
  const release = await db.corpusRelease.findUnique({
    where: {
      corpusId_version: {
        corpusId: request.release.corpusId,
        version: request.release.version,
      },
    },
  });
  if (release && release.manifestHash !== request.release.manifestHash) {
    throw new Error('Published corpus version has different manifest bytes');
  }
  const releaseId =
    release?.id ??
    corpusId(
      'corpus-release',
      `${request.release.corpusId}:${request.release.version}`,
    );
  const receipt = await readReceipt(db, request, releaseId);
  const content = createCorpusContent(request.ownerId, request.sources);
  const batchCount = request.sources.length + 1 + request.entries.length;
  if (receipt?.status === 'completed') {
    return completedInstall({
      request,
      content,
      releaseId,
      receipt,
      batchCount,
    });
  }
  const prior = await loadPriorItems(db, request);
  const items = await planItems(db, { request, content, prior });
  const checkpoint = Number(
    (receipt?.counts as { checkpoint?: number } | undefined)?.checkpoint ?? 0,
  );

  return {
    request,
    content,
    releaseId,
    prior,
    plan: {
      installId:
        receipt?.id ?? corpusId(request.ownerId, `install:${releaseId}`),
      completed: false,
      checkpoint,
      batchCount,
      predictedStatements:
        (batchCount - checkpoint) * predictedBatchStatements +
        predictedSetupStatements,
      items,
    },
  };
}

/**
 * selects a safe draft action against the previously installed base
 * @param head current collector working head
 * @param previous prior receipt item
 * @param hash incoming canonical envelope hash
 * @returns installation disposition
 */
export function disposition(
  head: knowledgeEntries | undefined | null,
  previous: CorpusInstallItem | undefined,
  hash: string,
): CorpusInstallDisposition['disposition'] {
  if (!head) {
    return 'created';
  }
  if (previous?.contentHash === hash && previous.disposition !== 'conflict') {
    return 'unchanged';
  }
  if (
    head.currentRevision !== previous?.revision ||
    (head.latestSavedRevision !== null &&
      head.latestSavedRevision >= previous.revision) ||
    previous.disposition === 'conflict'
  ) {
    return 'conflict';
  }

  return 'update_draft';
}

/**
 * compares incoming envelopes against owner-scoped collector heads in one query
 * @param db database query capability
 * @param input validated content and pinned previous receipt items
 * @param input.request explicit owner request
 * @param input.content deterministic content conversion
 * @param input.prior prior installed bases
 * @returns planned per-entry dispositions
 */
async function planItems(
  db: Database,
  input: Pick<PreparedInstall, 'request' | 'content' | 'prior'>,
): Promise<CorpusInstallPlan['items']> {
  const { request, content, prior } = input;
  const entries = await db.knowledgeEntries.findMany({
    where: {
      ownerId: request.ownerId,
      contentId: { in: request.entries.map((entry) => entry.id) },
    },
  });
  const existing = new Map(entries.map((entry) => [entry.contentId!, entry]));

  return request.entries.map((entry) => ({
    contentId: entry.id,
    disposition: disposition(
      existing.get(entry.id),
      prior.get(entry.id),
      canonicalHash(content.entry(entry)),
    ),
  }));
}

/**
 * rejects malformed identities and oversized source metadata before database writes
 * @param request validated installation request
 */
function validateRequest(request: CorpusInstallRequest): void {
  if (
    !request.ownerId ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      request.requestKey,
    )
  ) {
    throw new Error('Owner and UUID request key are required');
  }
  if (
    request.sources.some(
      (source) =>
        Buffer.byteLength(JSON.stringify(source.payload)) > maximumPayloadBytes,
    )
  ) {
    throw new Error('Corpus source exceeds the 256 KiB payload admission cap');
  }
}

/**
 * loads the latest pinned receipt for every prior content identity
 * @param db database query capability
 * @param request selected owner and corpus
 * @returns prior installed entry bases
 */
async function loadPriorItems(
  db: Database,
  request: CorpusInstallRequest,
): Promise<ReadonlyMap<string, CorpusInstallItem>> {
  const priorReceipts = await db.corpusInstall.findMany({
    where: {
      ownerId: request.ownerId,
      status: 'completed',
      release: { corpusId: request.release.corpusId },
    },
    orderBy: [{ installedAt: 'desc' }, { id: 'desc' }],
    include: { corpusInstallItemInstall: true },
  });
  const prior = new Map<string, CorpusInstallItem>();
  for (const previous of priorReceipts) {
    for (const item of previous.corpusInstallItemInstall) {
      if (!prior.has(item.contentId)) {
        prior.set(item.contentId, item);
      }
    }
  }

  return prior;
}

/**
 * resolves the owner receipt and rejects cross-release or incomplete request-key reuse
 * @param db database query capability
 * @param request explicit owner request
 * @param releaseId selected immutable release
 * @returns existing receipt or undefined
 */
async function readReceipt(
  db: Database,
  request: CorpusInstallRequest,
  releaseId: string,
): Promise<
  | Prisma.CorpusInstallGetPayload<{
      include: { corpusInstallItemInstall: true };
    }>
  | undefined
> {
  const receipts = await db.corpusInstall.findMany({
    where: {
      ownerId: request.ownerId,
      OR: [{ releaseId }, { requestKey: request.requestKey }],
    },
    include: { corpusInstallItemInstall: true },
  });
  const receipt = receipts.find((item) => item.releaseId === releaseId);
  if (
    receipts.some((item) => item.releaseId !== releaseId) ||
    (receipt?.requestKey !== undefined &&
      receipt.status !== 'completed' &&
      receipt.requestKey !== request.requestKey)
  ) {
    throw new Error('Request key is bound to another installation');
  }

  return receipt;
}

/**
 * returns completed receipt dispositions without generating any new rows
 * @param input persisted receipt and selected release context
 * @param input.request explicit owner request
 * @param input.content pinned content conversion
 * @param input.releaseId selected release identity
 * @param input.receipt completed persisted receipt
 * @param input.batchCount deterministic batch count
 * @returns completed installation context
 */
function completedInstall(input: {
  readonly request: CorpusInstallRequest;
  readonly content: CorpusContent;
  readonly releaseId: string;
  readonly receipt: Prisma.CorpusInstallGetPayload<{
    include: { corpusInstallItemInstall: true };
  }>;
  readonly batchCount: number;
}): PreparedInstall {
  const { request, content, releaseId, receipt, batchCount } = input;

  return {
    request,
    content,
    releaseId,
    prior: new Map(),
    plan: {
      installId: receipt.id,
      completed: true,
      checkpoint: batchCount,
      batchCount,
      predictedStatements: 0,
      items: receipt.corpusInstallItemInstall.map(
        ({ contentId, disposition }) => ({ contentId, disposition }),
      ),
    },
  };
}
