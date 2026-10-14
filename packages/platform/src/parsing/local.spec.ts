import { describe, expect, it } from 'vitest';

import { createLocalSourceParser } from './local.js';

import type { CanonicalView } from '@antica/domain';

import type { ParsingAsset } from './local.js';

const pageView: CanonicalView = {
  id: 'book-view',
  originalAssetId: 'photo-page',
  derivativeId: 'upright-page',
  width: 600,
  height: 900,
  originalCoordinateSpace: 'image_pixels',
  transformToOriginal: [1, 0, 0, 0, 1, 0, 0, 0, 1],
};
const textAssets: Readonly<Record<string, ParsingAsset>> = {
  first: {
    id: 'first',
    mimeType: 'application/pdf',
    bytes: createPdf('Glaze reference'),
    printedPageLabel: '十二',
    view: null,
  },
  second: {
    id: 'second',
    mimeType: 'application/pdf',
    bytes: createPdf('Appendix A'),
    printedPageLabel: 'A-1',
    view: null,
  },
};

describe('fn:createLocalSourceParser', () => {
  it('should extract actual PDF text and preserve printed labels separately from zero-based page order', async () => {
    const parser = createLocalSourceParser({
      readAsset: async (id) => {
        const asset = textAssets[id];
        if (!asset) {
          throw new Error('Missing fixture asset');
        }

        return asset;
      },
      resolveSource: async () => ({ sourceId: 'book' }),
      writeArtifact: async () => 'parse-artifact',
    });

    const result = await parser.parse({
      sourceVersionId: 'book-v1',
      parseRunId: 'parse-1',
      originalAssetIds: ['first', 'second'],
    });

    expect(result).toMatchObject({
      success: true,
      data: {
        sourceVersionId: 'book-v1',
        rawOutputAssetId: 'parse-artifact',
        pages: [
          {
            originalAssetId: 'first',
            pageIndex: 0,
            printedPageLabel: '十二',
            pdfPageIndex: 0,
            rawText: expect.stringContaining('Glaze reference'),
          },
          {
            originalAssetId: 'second',
            pageIndex: 1,
            printedPageLabel: 'A-1',
            pdfPageIndex: 0,
            rawText: expect.stringContaining('Appendix A'),
          },
        ],
      },
    });
  });

  it('should preserve a photographed page as unreviewed evidence without inventing OCR text', async () => {
    const parser = createLocalSourceParser({
      readAsset: async () => ({
        id: 'photo-page',
        mimeType: 'image/png',
        bytes: Uint8Array.from(
          Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWZkAAAAASUVORK5CYII=',
            'base64',
          ),
        ),
        printedPageLabel: '17',
        view: pageView,
      }),
      resolveSource: async () => ({ sourceId: 'book' }),
      writeArtifact: async () => 'parse-artifact',
    });

    const result = await parser.parse({
      sourceVersionId: 'book-v1',
      parseRunId: 'parse-1',
      originalAssetIds: ['photo-page'],
    });

    expect(result).toMatchObject({
      success: true,
      data: {
        pages: [
          {
            pageIndex: 0,
            printedPageLabel: '17',
            rawText: '',
            quality: 'needs_review',
            view: pageView,
          },
        ],
        warnings: [
          expect.objectContaining({ messageZhHant: expect.any(String) }),
          expect.objectContaining({ messageZhHant: expect.any(String) }),
        ],
      },
    });
    if (!result.success) {
      throw new Error('Expected parsed page and warnings');
    }
    expect(result.data.warnings.map((warning) => warning.pageId)).toEqual([
      result.data.pages[0]!.id,
      result.data.pages[0]!.id,
    ]);
    expect(
      result.data.warnings.every(
        (warning) => warning.messageZhHant.trim().length > 0,
      ),
    ).toBe(true);
  });

  it('should fail unsupported input instead of fabricating a usable page', async () => {
    const parser = createLocalSourceParser({
      readAsset: async () => ({
        id: 'unknown',
        mimeType: 'application/zip',
        bytes: new Uint8Array([80, 75]),
        printedPageLabel: null,
        view: null,
      }),
      resolveSource: async () => ({ sourceId: 'book' }),
      writeArtifact: async () => 'parse-artifact',
    });

    const result = await parser.parse({
      sourceVersionId: 'book-v1',
      parseRunId: 'parse-1',
      originalAssetIds: ['unknown'],
    });

    expect(result).toMatchObject({
      success: false,
      error: { code: 'MEDIA_UNSUPPORTED' },
    });
  });

  it.each([null, { ...pageView, originalAssetId: 'another-photo' }])(
    'should reject a photographed page without its matching original view',
    async (view) => {
      const parser = createLocalSourceParser({
        readAsset: async () => ({
          id: 'photo-page',
          mimeType: 'image/png',
          bytes: new Uint8Array(),
          printedPageLabel: null,
          view,
        }),
        resolveSource: async () => ({ sourceId: 'book' }),
        writeArtifact: async () => 'parse-artifact',
      });

      expect(
        await parser.parse({
          sourceVersionId: 'book-v1',
          parseRunId: 'parse-1',
          originalAssetIds: ['photo-page'],
        }),
      ).toMatchObject({
        success: false,
        error: { code: 'EVIDENCE_INVALID', retryable: false },
      });
    },
  );

  it('should retain only selected pages from a source version', async () => {
    const parser = createLocalSourceParser({
      readAsset: async (id) => {
        const asset = textAssets[id];
        if (!asset) {
          throw new Error('Missing fixture asset');
        }

        return asset;
      },
      resolveSource: async () => ({ sourceId: 'book' }),
      writeArtifact: async () => 'parse-artifact',
    });
    const input = {
      sourceVersionId: 'book-v1',
      parseRunId: 'parse-1',
      originalAssetIds: ['first', 'second'],
    };
    const full = await parser.parse(input);
    if (!full.success) {
      throw new Error('Expected both source pages');
    }

    const result = await parser.parse({
      ...input,
      pageIds: [full.data.pages[1]!.id],
    });

    expect(result).toMatchObject({
      success: true,
      data: {
        pages: [{ originalAssetId: 'second', pageIndex: 1 }],
        images: [],
      },
    });
  });

  it('should reject a requested page outside the parsed source version', async () => {
    const parser = createLocalSourceParser({
      readAsset: async () => textAssets.first!,
      resolveSource: async () => ({ sourceId: 'book' }),
      writeArtifact: async () => 'parse-artifact',
    });

    expect(
      await parser.parse({
        sourceVersionId: 'book-v1',
        parseRunId: 'parse-1',
        originalAssetIds: ['first'],
        pageIds: ['other-page'],
      }),
    ).toMatchObject({
      success: false,
      error: { code: 'SOURCE_UNAVAILABLE', retryable: false },
    });
  });

  it('should surface failed parse-artifact persistence', async () => {
    const parser = createLocalSourceParser({
      readAsset: async () => textAssets.first!,
      resolveSource: async () => ({ sourceId: 'book' }),
      writeArtifact: async () => {
        throw new Error('Storage failed');
      },
    });

    expect(
      await parser.parse({
        sourceVersionId: 'book-v1',
        parseRunId: 'parse-1',
        originalAssetIds: ['first'],
      }),
    ).toMatchObject({
      success: false,
      error: { code: 'SOURCE_UNAVAILABLE', retryable: false },
      cause: expect.any(Error),
    });
  });

  it('should preserve line breaks and avoid copying the first printed label to later PDF pages', async () => {
    const pdf = createPdf(['First line\nSecond line', 'Appendix']);
    const parser = createLocalSourceParser({
      readAsset: async () => ({
        id: 'book-pdf',
        mimeType: 'application/pdf',
        bytes: pdf,
        printedPageLabel: '十二',
        view: null,
      }),
      resolveSource: async () => ({ sourceId: 'book' }),
      writeArtifact: async () => 'parse-artifact',
    });

    expect(
      await parser.parse({
        sourceVersionId: 'book-v1',
        parseRunId: 'parse-1',
        originalAssetIds: ['book-pdf'],
      }),
    ).toMatchObject({
      success: true,
      data: {
        pages: [
          {
            printedPageLabel: '十二',
            rawText: expect.stringContaining('First line\nSecond line'),
          },
          {
            printedPageLabel: null,
            rawText: expect.stringContaining('Appendix'),
          },
        ],
      },
    });
  });
});

function createPdf(input: string | readonly string[]): Uint8Array {
  const texts = typeof input === 'string' ? [input] : input;
  const fontId = texts.length + 3;
  const firstContentId = fontId + 1;
  const pageKids = texts.map((_, index) => `${index + 3} 0 R`).join(' ');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pageKids}] /Count ${texts.length} >>`,
    ...texts.map(
      (_, index) =>
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${firstContentId + index} 0 R >>`,
    ),
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ...texts.map((text) => {
      const stream = `BT /F1 12 Tf 14 TL 20 100 Td (${text.split('\n').join(') Tj T* (')}) Tj ET`;

      return `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
    }),
  ];
  const chunks = objects.map(
    (content, index) => `${index + 1} 0 obj\n${content}\nendobj\n`,
  );
  const header = '%PDF-1.4\n';
  const offsets = chunks.map(
    (_, index) => header.length + chunks.slice(0, index).join('').length,
  );
  const body = `${header}${chunks.join('')}`;
  const crossReference = offsets
    .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join('');

  return new TextEncoder().encode(
    `${body}xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${crossReference}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${body.length}\n%%EOF\n`,
  );
}
