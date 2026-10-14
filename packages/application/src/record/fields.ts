import { recordFieldsSchema } from '@antica/contracts';

import type { RecordDetail, RecordFields } from '@antica/contracts';

/**
 * projects the editable fields from a record without leaking lifecycle metadata
 * @param record supplies the current record and its editable values
 * @returns schema-validated fields available to an edit draft
 */
export function recordFieldsOf(record: RecordDetail): RecordFields {
  return recordFieldsSchema.parse({
    name: record.name,
    unitKind: record.unitKind,
    components: record.components,
    pieceCount: record.pieceCount,
    categoryIds: record.categoryIds,
    materialIds: record.materialIds,
    period: record.period,
    dimensions: record.dimensions,
    location: record.location,
    acquisition: record.acquisition,
    tags: record.tags,
    description: record.description,
    collectorJudgment: record.collectorJudgment,
  });
}
