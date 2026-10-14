import { createHash, randomUUID } from 'node:crypto';

import { inject, describe, expect } from 'vitest';

import {
  sourceAcceptedSchema,
  sourceDetailSchema,
  uploadSessionSchema,
} from '@antica/contracts';

import { createHttpTest } from './fixtures/http/test.js';

const resources = inject('httpResources');
const it = createHttpTest(resources['source-providers']!);

describe('Local source provider composition', () => {
  it('should retain an uploaded book page and persist parser limitations through the composed drain', async ({
    fixture,
  }) => {
    const intakeKey = randomUUID();
    const bytes = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAQAAAADCAIAAAA7ljmRAAAAEElEQVR4nGNIn90ORww4OQBl8BJtnUF/dAAAAABJRU5ErkJggg==',
      'base64',
    );
    const upload = uploadSessionSchema.parse(
      await (
        await fixture.request('/v1/media/uploads', 'POST', {
          requestKey: randomUUID(),
          target: { kind: 'source_intake', intakeKey },
          kind: 'photo',
          purpose: 'book_page',
          componentIds: [],
          fileName: 'page.png',
          mimeType: 'image/png',
          byteLength: bytes.length,
          sha256: createHash('sha256').update(bytes).digest('hex'),
        })
      ).json(),
    );
    if (upload.mode !== 'single') {
      throw new Error('Expected local single upload');
    }
    expect(
      (
        await fixture.runtime.app.request(upload.putUrl, {
          method: 'PUT',
          headers: upload.headers,
          body: bytes,
        })
      ).status,
    ).toBe(204);
    expect(
      (
        await fixture.request(`/v1/media/${upload.assetId}/complete`, 'POST', {
          requestKey: randomUUID(),
        })
      ).status,
    ).toBe(200);
    expect(await fixture.runtime.drain()).toMatchObject({
      settled: 1,
      failures: [],
    });
    const registered = await fixture.request('/v1/sources', 'POST', {
      mode: 'register',
      requestKey: randomUUID(),
      registration: {
        intakeKey,
        kind: 'book_pages',
        existingSourceId: null,
        expectedRevision: null,
        assets: [
          { assetId: upload.assetId, order: 0, printedPageLabel: '十二' },
        ],
        metadata: {
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
        },
      },
    });
    expect(registered.status).toBe(202);
    const accepted = sourceAcceptedSchema.parse(await registered.json());
    expect(await fixture.runtime.drain()).toMatchObject({
      settled: 1,
      failures: [],
    });
    const detail = sourceDetailSchema.parse(
      await (await fixture.request(`/v1/sources/${accepted.sourceId}`)).json(),
    );
    expect(detail.version).toMatchObject({
      id: accepted.sourceVersionId,
      status: 'partial',
    });
    expect(detail.pages.items).toMatchObject([
      {
        originalAssetId: upload.assetId,
        printedPageLabel: '十二',
        rawText: '',
        quality: 'needs_review',
      },
    ]);
    expect(detail.referenceImages).toHaveLength(1);
    expect(
      (await fixture.runtime.storage.read(`originals/${upload.assetId}`)).bytes,
    ).toEqual(bytes);
    expect(await fixture.runtime.drain()).toMatchObject({
      inspected: 0,
      settled: 0,
    });
  });
});
