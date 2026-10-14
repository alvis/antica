import { createHash } from 'node:crypto';

import type { SourceCitation, SourceVersion } from '@antica/domain';

import type { ParsedSourcePack, UnitOfWork } from '../../ports/index.js';

/** inputs for citation persistence within aggregate publication */
export interface PageCitationParams {
  readonly unit: UnitOfWork;
  readonly version: SourceVersion;
  readonly pack: ParsedSourcePack;
}

const citationDigestOffsets = {
  firstEnd: 8,
  secondEnd: 12,
  versionStart: 13,
  versionEnd: 16,
  variantStart: 17,
  variantEnd: 20,
  finalEnd: 32,
} as const;

/**
 * persists one stable citation for every page with extracted text
 * @param params existing aggregate transaction, source identity and parsed pages
 * @returns citations linked to the canonical pages
 */
export async function createPageCitations(
  params: PageCitationParams,
): Promise<readonly SourceCitation[]> {
  const { unit, version, pack } = params;
  const citations = pack.pages
    .filter((page) => page.rawText.trim())
    .map((page): SourceCitation => ({
      id: stableCitationId(page.id),
      locator: {
        kind: 'page',
        sourceId: version.sourceId,
        sourceVersionId: version.id,
        pageId: page.id,
        pageIndex: page.pageIndex,
        printedPageLabel: page.printedPageLabel,
        canonicalViewId: page.view.id,
        regionId: null,
        region: null,
        textRange: null,
      },
      relation: 'background',
      availability: 'stored',
      verification: page.quality === 'usable' ? 'located' : 'needs_review',
    }));
  for (const citation of citations) {
    if (!(await unit.sources.getCitation(citation.id))) {
      await unit.sources.addCitation(citation);
    }
  }

  return citations;
}

/**
 * derives the persisted citation UUID layout from a canonical page identifier
 * @param pageId canonical page identifier
 * @returns byte-identical deterministic page citation identifier
 */
export function stableCitationId(pageId: string): string {
  const digest = createHash('sha256')
    .update(`source-citation:${pageId}`)
    .digest('hex');
  const offsets = citationDigestOffsets;

  return `${digest.slice(0, offsets.firstEnd)}-${digest.slice(offsets.firstEnd, offsets.secondEnd)}-5${digest.slice(offsets.versionStart, offsets.versionEnd)}-a${digest.slice(offsets.variantStart, offsets.variantEnd)}-${digest.slice(offsets.variantEnd, offsets.finalEnd)}`;
}
