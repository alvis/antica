import {
  knowledgeDetailSchema,
  mediaDetailSchema,
  recordDetailSchema,
} from '@antica/contracts';

import { collectionRecord } from '../../mobile.spec.fixtures';

import { media } from '../media/containers/media.spec.fixtures';

import type { RecordDetail } from '@antica/contracts';

export const objectTypeId = '00000000-0000-4000-8000-000000000701';
export const materialId = '00000000-0000-4000-8000-000000000702';
export const otherMaterialId = '00000000-0000-4000-8000-000000000703';
export const cabinetId = '00000000-0000-4000-8000-000000000704';
export const studyId = '00000000-0000-4000-8000-000000000705';
export const componentId = '00000000-0000-4000-8000-000000000706';
export const receiptId = '00000000-0000-4000-8000-000000000707';

/** a record with every editable field known */
export const filledRecord: RecordDetail = recordDetailSchema.parse({
  ...collectionRecord,
  name: 'Blue-and-white bowl',
  pieceCount: 1,
  categoryIds: [objectTypeId],
  materialIds: [materialId],
  period: {
    label: 'Kangxi',
    fromYear: 1662,
    toYear: 1722,
    status: 'collectorClaim',
  },
  collectorJudgment: 'Foot ring looks period',
  condition: 'Hairline crack at the rim',
  dimensions: {
    height: { value: 8.4, unit: 'cm', componentId },
    diameter: { value: 160, unit: 'mm' },
    weight: { value: 320, unit: 'g' },
  },
  tags: ['bowl', 'porcelain'],
  acquisition: {
    acquiredOn: '2024-05-18',
    seller: 'Hollywood Road dealer',
    method: 'Purchase',
    amount: '1200',
    currency: 'HKD',
    receiptAssetIds: [receiptId],
    provenanceNote: 'From a Hong Kong family collection',
  },
  description: 'Porcelain bowl.',
  location: { locationId: cabinetId, detail: 'Second shelf' },
  components: [{ id: componentId, label: 'Bowl' }],
  mediaIds: [receiptId],
  recordRevision: 4,
});

/**
 * moves a record to a newer revision with some fields changed, as another writer would
 * @param record record to advance
 * @param fields fields the other writer changed
 * @returns the record at its next revision
 */
export function advanced(
  record: RecordDetail,
  fields: Partial<RecordDetail> = {},
): RecordDetail {
  return recordDetailSchema.parse({
    ...record,
    ...fields,
    recordRevision: record.recordRevision + 1,
  });
}

export const locations = [
  { id: cabinetId, label: 'Main display-room cabinet' },
  { id: studyId, label: 'Study' },
];

/**
 * builds a knowledge entry detail with a title
 * @param id entry identifier
 * @param title entry title
 * @returns the detail as the API returns it
 */
export function knowledgeDetail(
  id: string,
  title: string,
): ReturnType<typeof knowledgeDetailSchema.parse> {
  return knowledgeDetailSchema.parse({
    entry: {
      id,
      revision: 1,
      createdAt: collectionRecord.createdAt,
      updatedAt: collectionRecord.updatedAt,
      displayCode: 'K-1',
      status: 'saved',
      content: {
        titleZhHant: title,
        aliases: [],
        kinds: ['material'],
        otherKindLabel: null,
        summary: { textZhHant: '', citationIds: [], support: 'needs_source' },
        history: [],
        features: [],
        applicability: [],
        exampleReferenceImageIds: [],
        relatedEntryIds: [],
        citations: [],
      },
      methodIds: [],
      savedBy: 'collector',
    },
    methods: [],
    methodVersions: [],
    referenceImages: [],
    citations: [],
  });
}

/** a receipt photo the record holds */
export const receipt = mediaDetailSchema.parse({
  ...media,
  asset: {
    ...media.asset,
    id: receiptId,
    kind: 'photo',
    purpose: 'receipt',
    originalFileName: 'receipt.jpg',
  },
});

/**
 * builds a knowledge search page
 * @param items entries on the page
 * @returns the page as the API returns it
 */
export function knowledgePage(items: Array<{ id: string; title: string }>): {
  items: unknown[];
  nextCursor: null;
} {
  return {
    items: items.map((item) => ({
      id: item.id,
      displayCode: 'K-1',
      revision: 1,
      titleZhHant: item.title,
      kinds: ['material'],
      status: 'saved',
      summaryZhHant: '',
      citationCount: 0,
    })),
    nextCursor: null,
  };
}
