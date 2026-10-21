import {
  copyFields,
  measurementFields,
  recordEditFields,
} from './record-edit-draft';
import { parseField, sameField } from './record-edit-values';

import type { RecordFields } from '@antica/contracts';

import type { PlainMessageKey } from '../../i18n/messages';
import type { PurchaseValue } from '../../utils/field-value';

import type {
  MeasurementField,
  RecordEditDraft,
  RecordEditField,
} from './record-edit-draft';
import type { RecordEditValue, RecordFieldsPatch } from './record-edit-values';

type Dimensions = NonNullable<RecordFieldsPatch['dimensions']>;
type Acquisition = RecordFields['acquisition'];

/** acquisition fields saved as optional text */
const acquisitionTextFields = [
  'acquiredOn',
  'seller',
  'method',
  'provenanceNote',
] as const;

/**
 * lists the fields the collector changed since editing started
 * @param base form state when editing started, or when it was last refreshed
 * @param draft current form state
 * @returns fields whose saved value would differ from where editing started
 */
export function changedFields(
  base: RecordEditDraft,
  draft: RecordEditDraft,
): RecordEditField[] {
  return recordEditFields.filter((field) => !sameField(base, draft, field));
}

/**
 * validates the fields about to be saved
 * @param draft current form state
 * @param fields fields to validate
 * @returns the error message key of each invalid field
 */
export function fieldErrors(
  draft: RecordEditDraft,
  fields: readonly RecordEditField[],
): Partial<Record<RecordEditField, PlainMessageKey>> {
  return Object.fromEntries(
    fields.flatMap((field) => {
      const parsed = parseField(draft, field);

      return parsed.ok ? [] : [[field, parsed.error]];
    }),
  );
}

/**
 * finds the changed fields that also changed on the server, which must never be
 * overwritten silently; a field the server already holds as the collector typed
 * it, such as after a save whose reply was lost, has converged and is no conflict
 * @param versions form states to compare
 * @param versions.base form state built from the record when editing started
 * @param versions.latest form state built from the record as the server now holds it
 * @param versions.draft current form state
 * @param fields fields the collector changed
 * @returns the changed fields whose stored value moved since editing started to a value other than the edit
 */
export function conflictingFields(
  versions: {
    base: RecordEditDraft;
    latest: RecordEditDraft;
    draft: RecordEditDraft;
  },
  fields: readonly RecordEditField[],
): RecordEditField[] {
  const { base, latest, draft } = versions;

  return fields.filter(
    (field) =>
      !sameField(base, latest, field) && !sameField(latest, draft, field),
  );
}

/**
 * moves the form onto a newer record: unchanged fields take the newer values,
 * and only the fields the collector keeps hold their edit
 * @param draft current form state
 * @param latest form state built from the newer record
 * @param kept fields whose edit the collector keeps
 * @returns the form state based on the newer record
 */
export function rebaseDraft(
  draft: RecordEditDraft,
  latest: RecordEditDraft,
  kept: readonly RecordEditField[],
): RecordEditDraft {
  return copyFields(latest, draft, kept);
}

/**
 * writes one measurement into a copy of the dimensions, keeping its component
 * @param dimensions dimensions being assembled
 * @param latest dimensions the server holds
 * @param entry measured dimension and its new value
 * @param entry.field measured dimension
 * @param entry.value new measurement, or null to clear it
 * @returns the dimensions with that measurement replaced or cleared
 */
function withMeasurement(
  dimensions: Dimensions,
  latest: Dimensions,
  entry: { field: MeasurementField; value: RecordEditValue },
): Dimensions {
  const { [entry.field]: _replaced, ...rest } = dimensions;
  if (entry.value === null) {
    return { ...rest, [entry.field]: null };
  }
  const componentId = latest[entry.field]?.componentId;

  return {
    ...rest,
    [entry.field]: {
      ...(entry.value as object),
      ...(componentId ? { componentId } : {}),
    },
  };
}

/**
 * writes one acquisition field into a copy of the acquisition
 * @param acquisition acquisition being assembled
 * @param field which part of the acquisition the collector edited
 * @param value new value, or null to clear it
 * @returns the acquisition with that field replaced or cleared
 */
function withAcquisition(
  acquisition: Acquisition,
  field: RecordEditField,
  value: RecordEditValue,
): Acquisition {
  if (field === 'receiptAssetIds') {
    return {
      ...acquisition,
      receiptAssetIds: [...(value as readonly string[])],
    };
  }
  const keys =
    field === 'purchase' ? (['amount', 'currency'] as const) : [field];
  const kept = Object.fromEntries(
    Object.entries(acquisition).filter(
      ([key]) => !(keys as readonly string[]).includes(key),
    ),
  ) as Acquisition;
  if (value === null) {
    return kept;
  }

  return field === 'purchase'
    ? { ...kept, ...(value as PurchaseValue) }
    : { ...kept, [field]: value };
}

/**
 * builds the PATCH fields for the changed fields only, on top of the server's
 * latest record, so a field another writer changed meanwhile is never reset
 * @param latest record as the server last returned it
 * @param draft current form state
 * @param fields changed fields to send
 * @returns the record fields to send; untouched fields are omitted
 */
export function patchFields(
  latest: RecordFields,
  draft: RecordEditDraft,
  fields: readonly RecordEditField[],
): RecordFieldsPatch {
  const patch: Record<string, unknown> = {};
  for (const field of fields) {
    const parsed = parseField(draft, field);
    // a value that cannot be read is never sent; the editor blocks saving it first
    if (!parsed.ok) {
      continue;
    }
    const { value } = parsed;
    if ((measurementFields as readonly string[]).includes(field)) {
      patch.dimensions = withMeasurement(
        (patch.dimensions as Dimensions | undefined) ?? latest.dimensions,
        latest.dimensions,
        { field: field as MeasurementField, value },
      );
    } else if (
      field === 'purchase' ||
      field === 'receiptAssetIds' ||
      (acquisitionTextFields as readonly string[]).includes(field)
    ) {
      patch.acquisition = withAcquisition(
        (patch.acquisition as Acquisition | undefined) ?? latest.acquisition,
        field,
        value,
      );
    } else if (field === 'locationId' || field === 'locationDetail') {
      const location =
        (patch.location as RecordFields['location'] | undefined) ??
        latest.location;
      patch.location =
        field === 'locationId'
          ? { ...location, locationId: value as string | null }
          : { ...location, detail: value as string };
    } else {
      patch[field] = value;
    }
  }

  return patch;
}
