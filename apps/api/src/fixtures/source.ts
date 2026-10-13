import { randomUUID } from 'node:crypto';

import type { TransactionPort } from '@antica/application/ports';
import type { SourceCommand } from '@antica/contracts';

/**
 * Registers an owned media upload for a source command fixture.
 * @param transaction collector-scoped persistence
 * @param ownerId fixture collector
 * @param options media kind and readiness
 * @param options.ready whether the upload has completed processing
 * @param options.document whether the original is a PDF
 * @returns source registration command with one owned original asset
 */
export async function sourceInput(
  transaction: TransactionPort,
  ownerId: string,
  options: { ready?: boolean; document?: boolean } = {},
): Promise<Extract<SourceCommand, { mode: 'register' }>> {
  const assetId = randomUUID();
  const intakeKey = randomUUID();
  await transaction.run(ownerId, async (unit) => {
    await unit.media.createUpload(
      {
        requestKey: randomUUID(),
        target: { kind: 'source_intake', intakeKey },
        kind: options.document ? 'document' : 'photo',
        purpose: options.document ? 'book_file' : 'book_page',
        componentIds: [],
        fileName: options.document ? 'book.pdf' : 'page.jpg',
        mimeType: options.document ? 'application/pdf' : 'image/jpeg',
        byteLength: 12,
        sha256: assetId.replaceAll('-', '').repeat(2),
      },
      {
        assetId,
        mode: 'single',
        putUrl: 'https://storage.example/upload',
        headers: {},
        expiresAt: '2026-10-14T00:00:00.000Z',
      },
    );
    if (options.ready !== false) {
      await unit.media.complete(assetId, {
        assetId,
        state: 'uploaded',
        processingJobId: null,
      });
      await unit.media.markReadyOnce(assetId, 'uploaded');
    }

    return { success: true, data: undefined };
  });

  return {
    requestKey: randomUUID(),
    mode: 'register',
    registration: {
      intakeKey,
      kind: options.document ? 'book_pdf' : 'book_pages',
      existingSourceId: null,
      expectedRevision: null,
      assets: [{ assetId, order: 0, printedPageLabel: '十二' }],
      metadata: sourceMetadata(),
    },
  };
}

/**
 * Provides source metadata without shared mutable fixture state.
 * @returns collector-entered book metadata
 */
function sourceMetadata(): Extract<
  SourceCommand,
  { mode: 'register' }
>['registration']['metadata'] {
  return {
    title: '器物研究',
    contributors: [],
    authorStatus: 'unknown',
    editionStatement: null,
    publisher: null,
    publicationDateAsPrinted: null,
    isbn: null,
    languages: ['zh-Hant'],
    canonicalUrl: null,
    access: 'stored_copy',
    rightsStatement: null,
    attributionText: null,
  };
}
