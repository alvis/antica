import { recordFieldsSchema } from '@antica/contracts';

import type {
  ProposedChange,
  RecordDetail,
  RecordFields,
  RecordPatch,
} from '@antica/contracts';

/** every measurement a record keeps, so a proposed set can replace the whole of the saved one */
const measurementKinds = [
  'height',
  'width',
  'depth',
  'diameter',
  'seatHeight',
  'weight',
] as const satisfies ReadonlyArray<keyof RecordFields['dimensions']>;

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
    condition: record.condition,
    surface: record.surface,
  });
}

/**
 * the record fields an adopted proposal writes; a dimensions proposal names every measurement,
 * so a measurement it leaves out is cleared rather than kept from the saved set
 * @param change proposed change being adopted
 * @returns the partial record fields to patch
 */
export function adoptedFields(change: ProposedChange): RecordPatch['fields'] {
  if (change.field === 'dimensions') {
    return {
      dimensions: Object.fromEntries(
        measurementKinds.map((kind) => [kind, change.proposed[kind] ?? null]),
      ),
    };
  }

  return { [change.field]: change.proposed };
}
