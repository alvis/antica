import { View } from 'react-native';

import { ChoiceGroup } from '../../../components/ChoiceGroup';
import { FormField } from '../../../components/FormField';
import { useLocale } from '../../../providers/LocaleProvider';

import { proposalFieldTestId } from '../proposal-field-test-id';
import { editFieldName } from '../record-edit-display';
import {
  lengthUnits,
  measurementFields,
  weightUnits,
} from '../record-edit-draft';

import { RecordEditCard } from './RecordEditSection';

import type { FC } from 'react';

import type { MeasurementField } from '../record-edit-draft';

import type { RecordEditSectionProps } from './RecordEditSection';

/** properties for one measured dimension */
type MeasurementRowProps = RecordEditSectionProps & { field: MeasurementField };

/**
 * edits one dimension as a number and its unit; an empty number means unknown
 * @param props row properties
 * @param props.field measured dimension
 * @param props.draft form state
 * @param props.update writes form changes
 * @param props.errorOf translated validation error of a field
 * @returns the number input above its unit choices
 */
const MeasurementRow: FC<MeasurementRowProps> = ({
  field,
  draft,
  update,
  errorOf,
}) => {
  const { t } = useLocale();
  const name = editFieldName(field, t);
  const measurement = draft[field];
  const units = field === 'weight' ? weightUnits : lengthUnits;
  const id = proposalFieldTestId(field);

  return (
    <View style={{ gap: 8 }}>
      <FormField
        testID={`record-edit-field-${id}`}
        label={name}
        value={measurement.value}
        keyboardType="decimal-pad"
        error={errorOf(field)}
        onChangeText={(value) => update({ [field]: { ...measurement, value } })}
      />
      <ChoiceGroup
        label={t('unitOf', { field: name })}
        choices={units.map((unit) => ({
          value: unit,
          label: unit,
          accessibilityLabel: `${t('unitOf', { field: name })}: ${unit}`,
          testID: `record-edit-${id}-unit-${unit}`,
        }))}
        selected={[measurement.unit]}
        onToggle={(unit) => update({ [field]: { ...measurement, unit } })}
      />
    </View>
  );
};

/**
 * edits the record's dimensions and weight, each with its own unit, then its condition (品相),
 * which the design lists right after the size
 * @param props section properties
 * @returns the measurements card
 */
export const RecordEditMeasurements: FC<RecordEditSectionProps> = (props) => {
  const { t } = useLocale();
  const { draft, update } = props;

  return (
    <RecordEditCard testID="record-edit-measurements" title={t('measurements')}>
      {measurementFields.map((field) => (
        <MeasurementRow key={field} field={field} {...props} />
      ))}
      <FormField
        testID="record-edit-field-condition"
        label={t('condition')}
        hint={t('conditionHint')}
        value={draft.condition}
        multiline
        onChangeText={(condition) => update({ condition })}
      />
      <FormField
        testID="record-edit-field-surface"
        label={t('surface')}
        value={draft.surface}
        multiline
        onChangeText={(surface) => update({ surface })}
      />
    </RecordEditCard>
  );
};
