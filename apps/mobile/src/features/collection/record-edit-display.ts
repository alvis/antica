import { parseField } from './record-edit-values';

import type { PlainMessageKey, Translate } from '../../i18n/messages';
import type { FieldDisplayValue } from '../../utils/field-value';

import type { RecordEditDraft, RecordEditField } from './record-edit-draft';

/** finds the readable label of each kind of identifier a record field holds */
export type FieldLabels = {
  /** title of an object-type or material knowledge entry */
  readonly knowledge: (id: string) => string;
  /** label of a general location */
  readonly location: (id: string) => string;
  /** file name of a receipt */
  readonly media: (id: string) => string;
};

const labelKinds: Partial<Record<RecordEditField, keyof FieldLabels>> = {
  categoryIds: 'knowledge',
  materialIds: 'knowledge',
  receiptAssetIds: 'media',
  locationId: 'location',
};

/**
 * reads a field from a form state as the shared renderer shows it, with identifiers replaced by labels
 * @param draft form state holding the value
 * @param field field to show
 * @param labels label lookups for identifiers
 * @returns the readable value; text that cannot be saved yet is shown as typed
 */
export function displayValue(
  draft: RecordEditDraft,
  field: RecordEditField,
  labels: FieldLabels,
): FieldDisplayValue {
  const parsed = parseField(draft, field);
  if (!parsed.ok) {
    return null;
  }
  const kind = labelKinds[field];
  const { value } = parsed;
  if (!kind || value === null) {
    return value;
  }

  return typeof value === 'string'
    ? labels[kind](value)
    : (value as readonly string[]).map(labels[kind]);
}

const fieldNameKeys = {
  name: 'name',
  categoryIds: 'type',
  materialIds: 'material',
  period: 'period',
  collectorJudgment: 'collectorJudgment',
  height: 'height',
  width: 'width',
  depth: 'depth',
  diameter: 'diameter',
  weight: 'weight',
  pieceCount: 'pieceCount',
  tags: 'tags',
  acquiredOn: 'acquiredOn',
  seller: 'seller',
  method: 'acquisitionMethod',
  purchase: 'purchaseAmount',
  provenanceNote: 'provenanceNote',
  receiptAssetIds: 'receipt',
  description: 'descriptionAndNotes',
  locationId: 'generalLocation',
  locationDetail: 'locationDetail',
} as const satisfies Record<RecordEditField, PlainMessageKey>;

/**
 * names an editor field in the collector's language
 * @param field editor field
 * @param t translation function for message keys
 * @returns the localized field name
 */
export function editFieldName(field: RecordEditField, t: Translate): string {
  return t(fieldNameKeys[field]);
}
