import { createHash } from 'node:crypto';

import sharp from 'sharp';

import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

import type {
  ParsedSourcePack,
  SourceParsingPort,
} from '@antica/application/ports';
import type {
  CanonicalView,
  ReferenceImage,
  SourcePage,
  SourceRegion,
} from '@antica/domain';

/** carries validated original bytes and any existing image coordinate mapping */
export interface ParsingAsset {
  readonly id: string;
  readonly mimeType: string;
  readonly bytes: Uint8Array;
  readonly printedPageLabel: string | null;
  readonly view: CanonicalView | null;
  readonly presentation?: SourcePage['presentation'];
}

/** supplies authorized original assets and durable artifact writes */
export interface LocalSourceParserParams {
  readonly readAsset: (assetId: string) => Promise<ParsingAsset>;
  readonly resolveSource: (
    sourceVersionId: string,
  ) => Promise<{ readonly sourceId: string }>;
  readonly writeArtifact: (
    bytes: Uint8Array,
    mimeType: string,
  ) => Promise<string>;
}

interface ExtractedPage {
  readonly asset: ParsingAsset;
  readonly pdfPageIndex: number | null;
  readonly rawText: string;
  readonly printedPageLabel: string | null;
  readonly view: CanonicalView;
}

/**
 * extracts actual PDF text while preserving original image pages
 * @param params authorized byte readers and artifact writer
 * @returns local parser with explicit OCR limitations
 */
export function createLocalSourceParser(
  params: LocalSourceParserParams,
): SourceParsingPort {
  return {
    parse: async (input) => {
      try {
        const source = await params.resolveSource(input.sourceVersionId);
        const assets = await Promise.all(
          input.originalAssetIds.map(params.readAsset),
        );
        if (
          assets.some(
            (asset) =>
              ![
                'application/pdf',
                'image/jpeg',
                'image/png',
                'image/webp',
                'image/tiff',
              ].includes(asset.mimeType),
          )
        ) {
          return {
            success: false,
            error: {
              code: 'MEDIA_UNSUPPORTED',
              message:
                'The local parser supports PDF and photographed book pages.',
              retryable: false,
            },
          };
        }
        if (
          assets.some(
            (asset) =>
              asset.mimeType !== 'application/pdf' &&
              (!asset.view || asset.view.originalAssetId !== asset.id),
          )
        ) {
          return {
            success: false,
            error: {
              code: 'EVIDENCE_INVALID',
              message:
                'Photographed pages require their verified original-image view.',
              retryable: false,
            },
          };
        }
        const extracted = (
          await Promise.all(
            assets.map(async (asset) =>
              extractPages(asset, input.sourceVersionId),
            ),
          )
        ).flat();
        const pages: SourcePage[] = extracted.map((page, pageIndex) => ({
          id: stablePageId(
            `${input.sourceVersionId}:${page.asset.id}:${page.pdfPageIndex ?? 'image'}`,
          ),
          sourceVersionId: input.sourceVersionId,
          pageIndex,
          printedPageLabel: page.printedPageLabel,
          originalAssetId: page.asset.id,
          pdfPageIndex: page.pdfPageIndex,
          view: page.view,
          presentation: page.asset.presentation ?? null,
          rawText: page.rawText,
          searchText: page.rawText
            .normalize('NFKC')
            .toLocaleLowerCase('zh-Hant'),
          quality: page.rawText.trim() ? 'usable' : 'needs_review',
          regionIds: page.rawText.trim()
            ? [stablePageId(`${input.parseRunId}:${pageIndex}:text`)]
            : [],
        }));
        const selectedIds = input.pageIds ? new Set(input.pageIds) : null;
        if (
          selectedIds &&
          input.pageIds?.some((id) => !pages.some((page) => page.id === id))
        ) {
          return {
            success: false,
            error: {
              code: 'SOURCE_UNAVAILABLE',
              message:
                'The selected page does not belong to this source version.',
              retryable: false,
            },
          };
        }
        const selectedPages = pages.filter(
          (page) => !selectedIds || selectedIds.has(page.id),
        );
        const regions: SourceRegion[] = selectedPages.flatMap((page) =>
          page.regionIds.map((id) => ({
            id,
            sourceVersionId: input.sourceVersionId,
            pageId: page.id,
            kind: 'text' as const,
            region: { kind: 'rect' as const, x: 0, y: 0, width: 1, height: 1 },
            rawText: page.rawText,
            relatedRegionIds: [],
          })),
        );
        const images: ReferenceImage[] = selectedPages
          .filter((page) => page.pdfPageIndex === null)
          .map((page) => ({
            id: stablePageId(`${page.id}:whole-page`),
            sourceVersionId: input.sourceVersionId,
            locator: {
              kind: 'page',
              sourceId: source.sourceId,
              sourceVersionId: input.sourceVersionId,
              pageId: page.id,
              pageIndex: page.pageIndex,
              printedPageLabel: page.printedPageLabel,
              canonicalViewId: page.view.id,
              regionId: null,
              region: null,
              textRange: null,
            },
            figureRegionId: null,
            storedDerivativeId: page.view.derivativeId,
            externalImageUrl: null,
            originalCaption: null,
            generatedDescriptionZhHant: null,
            descriptionJobId: null,
            captionAssociation: 'none',
          }));
        const warnings = selectedPages
          .filter((page) => page.quality !== 'usable')
          .map((page) => ({
            pageId: page.id,
            messageZhHant:
              '尚未取得可用文字；本機未配置 OCR，請核對原頁。 / No usable text; OCR is not configured. Review the original page.',
          }));
        warnings.push(
          ...selectedPages.map((page) => ({
            pageId: page.id,
            messageZhHant:
              page.pdfPageIndex === null
                ? '僅保留整頁照片；尚未偵測或擷取個別圖版。 / The original page image is retained; individual figures have not been detected or extracted.'
                : '僅提取 PDF 文字與頁面座標；圖版偵測及影像擷取尚未完成。 / PDF text and page coordinates are retained; figure discovery and image extraction are incomplete.',
          })),
        );
        const pack = {
          sourceVersionId: input.sourceVersionId,
          parseRunId: input.parseRunId,
          pages: selectedPages,
          regions,
          images,
          warnings,
        };
        const rawOutputAssetId = await params.writeArtifact(
          new TextEncoder().encode(JSON.stringify(pack)),
          'application/json',
        );
        const result: ParsedSourcePack = { ...pack, rawOutputAssetId };

        return { success: true, data: result };
      } catch (cause) {
        return {
          success: false,
          error: {
            code: 'SOURCE_UNAVAILABLE',
            message:
              'The original document could not be parsed or its parse artifact could not be saved.',
            retryable: false,
          },
          cause,
        };
      }
    },
  };
}

/**
 * extracts original PDF text and verified canonical page geometry
 * @param asset authorized original file and presentation metadata
 * @param sourceVersionId immutable source version identity
 * @returns canonical pages with actual extracted text
 */
async function extractPages(
  asset: ParsingAsset,
  sourceVersionId: string,
): Promise<readonly ExtractedPage[]> {
  if (asset.mimeType !== 'application/pdf') {
    await sharp(asset.bytes).metadata();

    return [
      {
        asset,
        pdfPageIndex: null,
        rawText: '',
        printedPageLabel: asset.printedPageLabel,
        view: asset.view!,
      },
    ];
  }
  const task = getDocument({
    data: new Uint8Array(asset.bytes),
    useSystemFonts: false,
    disableFontFace: true,
  });
  const document = await task.promise;
  try {
    const labels = await document.getPageLabels();

    return await Promise.all(
      Array.from(
        { length: document.numPages },
        async (_, pdfPageIndex): Promise<ExtractedPage> => {
          const page = await document.getPage(pdfPageIndex + 1);
          const viewport = page.getViewport({ scale: 1 });
          const origin = viewport.convertToPdfPoint(0, 0);
          const right = viewport.convertToPdfPoint(
            viewport.width / Math.ceil(viewport.width),
            0,
          );
          const down = viewport.convertToPdfPoint(
            0,
            viewport.height / Math.ceil(viewport.height),
          );
          const content = await page.getTextContent({
            includeMarkedContent: false,
            disableNormalization: true,
          });
          // pdfjs only includes TextMarkedContent when includeMarkedContent is true.
          const textItems = content.items as Array<
            Extract<(typeof content.items)[number], { str: string }>
          >;
          const rawText = textItems
            .flatMap((item) => [item.str, item.hasEOL ? '\n' : ' '])
            .join('')
            .trimEnd();

          return {
            asset,
            pdfPageIndex,
            rawText,
            printedPageLabel:
              labels?.[pdfPageIndex] ??
              (pdfPageIndex === 0 ? asset.printedPageLabel : null),
            view: {
              id: stablePageId(
                `${sourceVersionId}:${asset.id}:${pdfPageIndex}:view`,
              ),
              originalAssetId: asset.id,
              derivativeId: null,
              width: Math.ceil(viewport.width),
              height: Math.ceil(viewport.height),
              originalCoordinateSpace: 'pdf_page_points',
              transformToOriginal: [
                right[0]! - origin[0]!,
                down[0]! - origin[0]!,
                origin[0]!,
                right[1]! - origin[1]!,
                down[1]! - origin[1]!,
                origin[1]!,
                0,
                0,
                1,
              ],
            },
          };
        },
      ),
    );
  } finally {
    await document.destroy();
  }
}

/**
 * derives a stable UUID-shaped canonical page identifier
 * @param value source version and original page identity
 * @returns stable page identifier
 */
function stablePageId(value: string): string {
  const digest = createHash('sha256').update(value).digest('hex');

  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}
