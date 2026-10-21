import type { RecordFields } from '@antica/contracts';

/** units a length dimension accepts */
export const lengthUnits = ['mm', 'cm', 'm'] as const;

/** units a weight accepts */
export const weightUnits = ['g', 'kg'] as const;

/** dimensions the editor measures, each with its own unit */
export const measurementFields = [
  'height',
  'width',
  'depth',
  'diameter',
  'seatHeight',
  'weight',
] as const;

/** one measured dimension of the record */
export type MeasurementField = (typeof measurementFields)[number];

/** a measurement as typed: the number text and its chosen unit */
export type MeasurementDraft = {
  readonly value: string;
  readonly unit: string;
};

/** whose judgment a candidate period is */
export type PeriodStatus = NonNullable<RecordFields['period']>['status'];

/** the editor's form state; text fields hold what the collector typed */
export type RecordEditDraft = {
  readonly name: string;
  readonly categoryIds: readonly string[];
  readonly materialIds: readonly string[];
  readonly periodLabel: string;
  readonly periodFrom: string;
  readonly periodTo: string;
  readonly periodStatus: PeriodStatus;
  readonly collectorJudgment: string;
  readonly condition: string;
  readonly surface: string;
  readonly height: MeasurementDraft;
  readonly width: MeasurementDraft;
  readonly depth: MeasurementDraft;
  readonly diameter: MeasurementDraft;
  readonly seatHeight: MeasurementDraft;
  readonly weight: MeasurementDraft;
  readonly pieceCount: string;
  readonly tags: readonly string[];
  readonly acquiredOn: string;
  readonly seller: string;
  readonly method: string;
  readonly amount: string;
  readonly currency: string;
  readonly provenanceNote: string;
  readonly receiptAssetIds: readonly string[];
  readonly description: string;
  readonly locationId: string | null;
  readonly locationDetail: string;
};

/**
 * the fields the editor saves and compares one by one; a conflict, a change, and
 * a validation error each name one of these
 */
export const recordEditFields = [
  'name',
  'categoryIds',
  'materialIds',
  'period',
  'collectorJudgment',
  ...measurementFields,
  'condition',
  'surface',
  'pieceCount',
  'tags',
  'acquiredOn',
  'seller',
  'method',
  'purchase',
  'provenanceNote',
  'receiptAssetIds',
  'description',
  'locationId',
  'locationDetail',
] as const;

/** one field the editor saves and compares on its own */
export type RecordEditField = (typeof recordEditFields)[number];

/** form keys that hold each field; most fields hold one key of the same name */
const groupedKeys: Partial<
  Record<RecordEditField, ReadonlyArray<keyof RecordEditDraft>>
> = {
  period: ['periodLabel', 'periodFrom', 'periodTo', 'periodStatus'],
  purchase: ['amount', 'currency'],
};

/**
 * names the form keys that hold a field
 * @param field field the editor compares
 * @returns the form keys holding its value
 */
export function draftKeys(
  field: RecordEditField,
): ReadonlyArray<keyof RecordEditDraft> {
  return groupedKeys[field] ?? [field as keyof RecordEditDraft];
}

/**
 * writes a measurement into the form, leaving an unknown one empty
 * @param measurement stored measurement, if known
 * @param measurement.value stored number
 * @param measurement.unit stored unit
 * @param fallbackUnit unit preselected for an unknown measurement
 * @returns the measurement as the form shows it
 */
function measurementDraft(
  measurement: { value: number; unit: string } | undefined,
  fallbackUnit: string,
): MeasurementDraft {
  return measurement
    ? { value: String(measurement.value), unit: measurement.unit }
    : { value: '', unit: fallbackUnit };
}

/**
 * fills the form from a record without inventing anything: an unknown value stays empty
 * @param record stored record fields
 * @returns the form state for those fields
 */
export function draftFromRecord(record: RecordFields): RecordEditDraft {
  const { acquisition, dimensions, period } = record;

  return {
    name: record.name ?? '',
    categoryIds: record.categoryIds,
    materialIds: record.materialIds,
    periodLabel: period?.label ?? '',
    periodFrom: period?.fromYear === undefined ? '' : String(period.fromYear),
    periodTo: period?.toYear === undefined ? '' : String(period.toYear),
    periodStatus: period?.status ?? 'collectorClaim',
    collectorJudgment: record.collectorJudgment ?? '',
    condition: record.condition ?? '',
    surface: record.surface ?? '',
    height: measurementDraft(dimensions.height, 'cm'),
    width: measurementDraft(dimensions.width, 'cm'),
    depth: measurementDraft(dimensions.depth, 'cm'),
    diameter: measurementDraft(dimensions.diameter, 'cm'),
    seatHeight: measurementDraft(dimensions.seatHeight, 'cm'),
    weight: measurementDraft(dimensions.weight, 'g'),
    pieceCount: record.pieceCount === null ? '' : String(record.pieceCount),
    tags: record.tags,
    acquiredOn: acquisition.acquiredOn ?? '',
    seller: acquisition.seller ?? '',
    method: acquisition.method ?? '',
    amount: acquisition.amount ?? '',
    currency: acquisition.currency ?? '',
    provenanceNote: acquisition.provenanceNote ?? '',
    receiptAssetIds: acquisition.receiptAssetIds,
    description: record.description,
    locationId: record.location.locationId,
    locationDetail: record.location.detail,
  };
}

/**
 * copies the chosen fields from one form state into another
 * @param target form state that receives the values
 * @param source form state the values come from
 * @param fields fields to copy
 * @returns the target with those fields taken from the source
 */
export function copyFields(
  target: RecordEditDraft,
  source: RecordEditDraft,
  fields: readonly RecordEditField[],
): RecordEditDraft {
  const entries = fields.flatMap((field) =>
    draftKeys(field).map((key) => [key, source[key]] as const),
  );

  return { ...target, ...Object.fromEntries(entries) };
}
