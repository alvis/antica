import type {
  KnowledgeEntry,
  SourceCitation,
  SourceVersion,
} from '@antica/domain';

import type {
  ClockPort,
  IdPort,
  ParsedSourcePack,
  UnitOfWork,
} from '../../ports/index.js';

/** inputs for a source-created, unsaved knowledge draft */
export interface SourceDraftParams {
  readonly unit: UnitOfWork;
  readonly version: SourceVersion;
  readonly pack: ParsedSourcePack;
  readonly citations: readonly SourceCitation[];
  readonly clock: ClockPort;
  readonly ids: IdPort;
}

interface DraftEntryParams {
  readonly version: SourceVersion;
  readonly pack: ParsedSourcePack;
  readonly citations: readonly SourceCitation[];
  readonly now: string;
  readonly entryId: string;
  readonly displayCode: string;
  readonly page: ParsedSourcePack['pages'][number] | undefined;
  readonly firstCitation: SourceCitation | null | undefined;
}

const sourceDraftExcerptLength = 500;

/**
 * seeds an unsaved knowledge draft once from real page text
 * @param params existing aggregate transaction, parsed content and ID sources
 * @returns when the draft has been linked, or an existing draft was retained
 */
export async function createSourceDraft(
  params: SourceDraftParams,
): Promise<void> {
  const { unit, version, pack, citations, clock, ids } = params;
  const existing = await unit.sources.get(version.sourceId, version.id);
  if (existing?.knowledgeDraftIds.length) {
    return;
  }
  const page = pack.pages.find((candidate) => candidate.rawText.trim());
  const firstCitation = page
    ? citations.find(
        (citation) =>
          citation.locator.kind === 'page' &&
          citation.locator.pageId === page.id,
      )
    : null;
  const now = clock.now();
  const entryId = ids.create();
  const displayCode = await unit.knowledge.allocateCode();
  const entry = buildDraftEntry({
    version,
    pack,
    citations,
    now,
    entryId,
    displayCode,
    page,
    firstCitation,
  });
  await unit.knowledge.create(entry);
  await unit.sources.linkKnowledgeDraft(version.id, entryId);
}

/**
 * builds the existing draft content and first-page citation relationship
 * @param params parsed content and identifiers already allocated by the transaction
 * @returns unsaved knowledge entry for collector review
 */
function buildDraftEntry(params: DraftEntryParams): KnowledgeEntry {
  const {
    version,
    pack,
    citations,
    now,
    entryId,
    displayCode,
    page,
    firstCitation,
  } = params;

  return {
    id: entryId,
    revision: 1,
    createdAt: now,
    updatedAt: now,
    displayCode,
    status: 'draft',
    savedBy: null,
    methodIds: [],
    content: {
      titleZhHant: version.metadataSnapshot.title,
      aliases: [],
      kinds: ['other'],
      otherKindLabel: '來源摘錄',
      summary: {
        textZhHant: '來源已匯入，請核對原頁並補充知識內容。',
        citationIds: [],
        support: 'needs_source',
      },
      history:
        page && firstCitation
          ? [
              {
                textZhHant: `原文摘錄：${page.rawText.slice(0, sourceDraftExcerptLength)}`,
                citationIds: [firstCitation.id],
                support:
                  firstCitation.verification === 'located'
                    ? 'cited'
                    : 'needs_source',
              },
            ]
          : [],
      features: [],
      applicability: [],
      exampleReferenceImageIds: pack.images.map((image) => image.id),
      relatedEntryIds: [],
      citations,
    },
  };
}
