import { Text, View } from 'react-native';

import { ActionButton, colors, styles } from '@antica/ui';

import { ChoiceGroup } from '../../../components/ChoiceGroup';
import { FieldValue } from '../../../components/FieldValue';
import { useLocale } from '../../../providers/LocaleProvider';

import { proposalFieldTestId } from '../proposal-field-test-id';
import { displayValue, editFieldName } from '../record-edit-display';

import type { FC } from 'react';

import type { ConflictChoice } from '../hooks/useRecordEdit';
import type { FieldLabels } from '../record-edit-display';
import type { RecordEditDraft, RecordEditField } from '../record-edit-draft';

/** properties for the fields that changed on the server while the collector edited them */
export type RecordEditConflictProps = {
  fields: readonly RecordEditField[];
  /** the collector's form state */
  mine: RecordEditDraft;
  /** form state built from the record as the server now holds it */
  current: RecordEditDraft;
  choices: Partial<Record<RecordEditField, ConflictChoice>>;
  labels: FieldLabels;
  onChoose: (field: RecordEditField, choice: ConflictChoice) => void;
  onSave: () => void;
};

/** properties for one field in conflict */
type ConflictFieldProps = Omit<RecordEditConflictProps, 'fields' | 'onSave'> & {
  field: RecordEditField;
};

/**
 * shows the collector's edit beside the current value of one field, with the choice of which to keep
 * @param props one conflicting field and the choice made for it
 * @param props.field the record field both the collector and another writer changed
 * @param props.mine the collector's form state
 * @param props.current form state built from the latest record
 * @param props.choices choices made so far
 * @param props.labels label lookups for identifiers
 * @param props.onChoose records a choice
 * @returns the field's values side by side with its choices
 */
const ConflictField: FC<ConflictFieldProps> = ({
  field,
  mine,
  current,
  choices,
  labels,
  onChoose,
}) => {
  const { t } = useLocale();
  const name = editFieldName(field, t);
  const id = proposalFieldTestId(field);
  // each value takes half the width, and wraps below the other on a narrow screen
  const column = { flexGrow: 1, flexBasis: 140 } as const;

  return (
    <View
      testID={`record-edit-conflict-${id}`}
      style={[styles.card, { borderColor: colors.warning }]}>
      <Text accessibilityRole="header" style={styles.label}>
        {name}
      </Text>
      <View style={[styles.row, { alignItems: 'flex-start' }]}>
        <View style={column}>
          <FieldValue
            label={t('yourEdit')}
            value={displayValue(mine, field, labels)}
          />
        </View>
        <View style={column}>
          <FieldValue
            label={t('currentValue')}
            value={displayValue(current, field, labels)}
          />
        </View>
      </View>
      <ChoiceGroup
        label={name}
        choices={[
          {
            value: 'mine',
            label: t('keepMine'),
            accessibilityLabel: t('keepMineFor', { field: name }),
            testID: `record-edit-conflict-keep-mine-${id}`,
          },
          {
            value: 'current',
            label: t('useCurrent'),
            accessibilityLabel: t('useCurrentFor', { field: name }),
            testID: `record-edit-conflict-use-current-${id}`,
          },
        ]}
        selected={choices[field] ? [choices[field]] : []}
        onToggle={(choice) => onChoose(field, choice as ConflictChoice)}
      />
    </View>
  );
};

/**
 * lists only the changed fields that also changed on the server; nothing is
 * saved until the collector chose, for each one, to keep their edit or use the current value
 * @param props the conflicting fields, both versions, and the choices
 * @param props.fields every record field both the collector and another writer changed
 * @param props.onSave saves with the chosen values
 * @returns the conflict view
 */
export const RecordEditConflict: FC<RecordEditConflictProps> = ({
  fields,
  onSave,
  ...field
}) => {
  const { t } = useLocale();
  const decided = fields.every((item) => field.choices[item]);

  return (
    <View testID="record-edit-conflict" style={styles.card}>
      <Text
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
        style={styles.heading}>
        {t('conflictTitle')}
      </Text>
      <Text style={styles.secondary}>{t('conflictHint')}</Text>
      {fields.map((item) => (
        <ConflictField key={item} field={item} {...field} />
      ))}
      <ActionButton
        testID="record-edit-conflict-save"
        label={t('saveChoices')}
        disabled={!decided}
        onPress={onSave}
      />
    </View>
  );
};
