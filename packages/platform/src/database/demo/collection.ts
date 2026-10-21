import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import {
  evidenceAnchorSchema,
  locationSchema,
  recordDetailSchema,
} from '@antica/contracts';

import { demoRecords } from './fixtures/records.js';
import { vocabularyEntryId } from './knowledge.js';
import { renderAnglePhoto, renderReceiptPhoto } from './photos.js';

import type { RecordDetail } from '@antica/contracts';

import type { DemoApi } from './api.js';
import type { DemoRecord } from './fixtures/records.js';
import type { DemoRecordKey } from './fixtures.js';

/** ids of one seeded record */
export interface SeededRecord {
  readonly id: string;
  readonly code: string;
  /** object photos in carousel order; the first is the cover */
  readonly photoIds: readonly string[];
  readonly receiptId: string | null;
}

/** seeded records by design key */
export type SeededCollection = Readonly<Record<DemoRecordKey, SeededRecord>>;

/** photos of a seeded record to anchor as evidence */
export interface EvidenceRequest {
  readonly record: SeededRecord;
  /** design object whose angle order the photos follow */
  readonly demo: DemoRecord;
  /** photo angle labels to anchor */
  readonly labels: readonly string[];
}

/**
 * creates locations, records, photos and receipts through the API, oldest record first
 * @param api demo owner session
 * @param vocabulary knowledge entry id per vocabulary title
 * @returns seeded record ids by key
 */
export async function createCollection(
  api: DemoApi,
  vocabulary: ReadonlyMap<string, string>,
): Promise<SeededCollection> {
  const locationIds = new Map<string, string>();
  const created = new Map<DemoRecordKey, SeededRecord>();
  for (const demo of demoRecords) {
    const locationId =
      locationIds.get(demo.location.label) ??
      (
        await api.request('/v1/locations', locationSchema, {
          method: 'POST',
          body: {
            label: demo.location.label,
          },
        })
      ).id;
    locationIds.set(demo.location.label, locationId);
    const record = await api.request('/v1/records', recordDetailSchema, {
      method: 'POST',
      body: {
        unitKind: 'single',
        name: demo.savedName,
        categoryIds: [vocabularyEntryId(vocabulary, demo.category)],
        materialIds: demo.materials.map((term) =>
          vocabularyEntryId(vocabulary, term),
        ),
        period: demo.period,
        dimensions: demo.dimensions,
        location: { locationId, detail: demo.location.detail },
        acquisition: { ...demo.acquisition, receiptAssetIds: [] },
        tags: [],
        description: demo.description,
        collectorJudgment: null,
        condition: demo.condition,
      },
    });
    created.set(demo.key, await attachMedia(api, demo, record));
  }

  return {
    dish: seeded(created, 'dish'),
    chair: seeded(created, 'chair'),
    jar: seeded(created, 'jar'),
    cup: seeded(created, 'cup'),
    bi: seeded(created, 'bi'),
  };
}

/**
 * anchors whole-image evidence on the photos that analysis findings cite
 * @param api demo owner session
 * @param request record, its angle order and the labels to anchor
 * @returns evidence anchor id per angle label
 */
export async function createEvidence(
  api: DemoApi,
  request: EvidenceRequest,
): Promise<ReadonlyMap<string, string>> {
  const { record, demo, labels } = request;
  const angles = demo.angles.map((angle) => angle.label);
  const anchors = new Map<string, string>();
  for (const label of new Set(labels)) {
    const assetId = record.photoIds[angles.indexOf(label)];
    if (!assetId) {
      throw new Error(`No ${label} photo on ${record.code}`);
    }
    const [media] = await api.waitUntilReady([assetId]);
    const view = media?.asset.views[0];
    if (!view) {
      throw new Error(`The ${label} photo has no canonical view`);
    }
    const anchor = await api.request('/v1/evidence', evidenceAnchorSchema, {
      method: 'POST',
      body: {
        requestKey: randomUUID(),
        mode: 'create',
        evidence: {
          kind: 'image',
          recordId: record.id,
          componentIds: [],
          originalAssetId: assetId,
          canonicalViewId: view.id,
          scope: { kind: 'whole' },
        },
      },
    });
    anchors.set(label, anchor.id);
  }

  return anchors;
}

/**
 * uploads the six angle photos and the receipt, then links the receipt to the acquisition
 * @param api demo owner session
 * @param demo the design object
 * @param record the created record
 * @returns the record's seeded ids
 */
async function attachMedia(
  api: DemoApi,
  demo: DemoRecord,
  record: RecordDetail,
): Promise<SeededRecord> {
  const source = await readFile(
    fileURLToPath(new URL(`images/${demo.image}.jpg`, import.meta.url)),
  );
  const photos = await Promise.all(
    demo.angles.map(async (angle) => renderAnglePhoto(source, angle)),
  );
  const photoIds: string[] = [];
  // sequential uploads keep the carousel order in the photos' creation order
  for (const [index, angle] of demo.angles.entries()) {
    photoIds.push(
      await api.upload({
        recordId: record.id,
        purpose: 'object',
        fileName: `${angle.label}.jpg`,
        bytes: photos[index]!,
      }),
    );
  }
  const receiptId = demo.hasReceipt
    ? await uploadReceipt(api, demo, record)
    : null;
  await api.waitUntilReady(receiptId ? [...photoIds, receiptId] : photoIds);
  if (receiptId) {
    const current = await api.request(
      `/v1/records/${record.id}`,
      recordDetailSchema,
    );
    await api.request(`/v1/records/${record.id}`, recordDetailSchema, {
      method: 'PATCH',
      body: {
        expectedRevision: current.recordRevision,
        fields: {
          acquisition: { ...current.acquisition, receiptAssetIds: [receiptId] },
        },
      },
    });
  }

  return { id: record.id, code: record.code, photoIds, receiptId };
}

/**
 * uploads a paper slip standing in for the purchase receipt
 * @param api demo owner session
 * @param demo the design object
 * @param record the created record
 * @returns the receipt asset id
 */
async function uploadReceipt(
  api: DemoApi,
  demo: DemoRecord,
  record: RecordDetail,
): Promise<string> {
  return api.upload({
    recordId: record.id,
    purpose: 'receipt',
    fileName: '購買單據.jpg',
    bytes: await renderReceiptPhoto([
      '收據（示範用）',
      demo.acquisition.seller ?? '',
      demo.name,
      demo.acquisition.acquiredOn ?? '',
    ]),
  });
}

/**
 * reads a created record by key
 * @param created seeded records so far
 * @param key design key
 * @returns the seeded record
 */
function seeded(
  created: ReadonlyMap<DemoRecordKey, SeededRecord>,
  key: DemoRecordKey,
): SeededRecord {
  const record = created.get(key);
  if (!record) {
    throw new Error(`Design object ${key} was not created`);
  }

  return record;
}
