import { useState } from 'react';

import { Pressable, Text } from 'react-native';

import { colors, styles } from '@antica/ui';

import { FieldValue } from '../../../components/FieldValue';
import { useLocale } from '../../../providers/LocaleProvider';

import { proposalFieldTestId } from '../proposal-field-test-id';
import { displayValue, editFieldName } from '../record-edit-display';
import {
  draftFromRecord,
  measurementFields,
  recordEditFields,
} from '../record-edit-draft';

import { RecordEditCard } from './RecordEditSection';

import type { FC } from 'react';

import type { RecordFields } from '@antica/contracts';

import type { FieldDisplayValue } from '../../../utils/field-value';

import type { FieldLabels } from '../record-edit-display';
import type { RecordEditField } from '../record-edit-draft';

/** properties for the record's saved field values */
export type RecordFieldSummaryProps = {
  record: RecordFields;
  labels: FieldLabels;
};

/** the record's key facts, shown while the summary is collapsed (B06) */
const keyFields = new Set<RecordEditField>([
  'pieceCount',
  ...measurementFields,
  'locationId',
  'locationDetail',
  'description',
]);

/** fields read as running text, too long to sit beside their label */
const longFields = new Set<RecordEditField>(['description', 'provenanceNote']);

/**
 * tells whether a field value is known
 * @param value displayed field value
 * @returns false for a value the record leaves unknown
 */
function known(value: FieldDisplayValue): boolean {
  return !(
    value === null ||
    value === '' ||
    (Array.isArray(value) && !value.length)
  );
}

/**
 * summarises the record's known field values, formatted the same way as the
 * editor and history; it shows the key facts and expands to every known field,
 * while unknown fields are left out rather than filled in
 * @param props summary properties
 * @param props.record saved record fields
 * @param props.labels label lookups for identifiers
 * @returns the details card
 */
export const RecordFieldSummary: FC<RecordFieldSummaryProps> = ({
  record,
  labels,
}) => {
  const { t } = useLocale();
  const [expanded, setExpanded] = useState(false);
  const draft = draftFromRecord(record);
  // the name is the screen's title
  const rows = recordEditFields
    .filter((field) => field !== 'name')
    .map((field) => ({ field, value: displayValue(draft, field, labels) }))
    .filter(({ value }) => known(value));
  const more = rows.some(({ field }) => !keyFields.has(field));

  return (
    <RecordEditCard testID="record-fields" title={t('recordDetails')}>
      {!rows.length && <Text style={styles.secondary}>{t('empty')}</Text>}
      {rows
        .filter(({ field }) => expanded || keyFields.has(field))
        .map(({ field, value }) => (
          <FieldValue
            key={field}
            inline={!longFields.has(field)}
            testID={`record-field-${proposalFieldTestId(field)}`}
            label={editFieldName(field, t)}
            value={value}
          />
        ))}
      {more && (
        <Pressable
          testID="record-fields-toggle"
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          hitSlop={12}
          onPress={() => setExpanded((current) => !current)}
          style={{ minHeight: 44, justifyContent: 'center' }}>
          <Text style={[styles.label, { color: colors.jade }]}>
            {expanded ? t('showFewerDetails') : t('showAllDetails')}
          </Text>
        </Pressable>
      )}
    </RecordEditCard>
  );
};
