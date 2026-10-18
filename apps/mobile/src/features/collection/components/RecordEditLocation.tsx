import { useState } from 'react';

import { Text, View } from 'react-native';

import { ActionButton, styles } from '@antica/ui';

import { ChoiceGroup } from '../../../components/ChoiceGroup';
import { FieldError, FormField } from '../../../components/FormField';
import { useLocale } from '../../../providers/LocaleProvider';

import { RecordEditCard } from './RecordEditSection';

import type { FC } from 'react';

import type { Location } from '@antica/contracts';

import type { RecordEditSectionProps } from './RecordEditSection';

/** properties for the two location fields */
export type RecordEditLocationProps = RecordEditSectionProps & {
  /** the collector's general locations; a single level, never a hierarchy */
  locations: readonly Location[];
  /** saves a new general location label and returns it, or an existing one with that label */
  onAddLocation: (label: string) => Promise<Location>;
};

/** choice value of the "not set" general location */
const notSet = '';

/**
 * offers a new general location label, which is selected once saved
 * @param props properties
 * @param props.onAdded selects the saved location
 * @param props.onAddLocation saves the label
 * @returns the label input and its add action
 */
const NewLocation: FC<
  Pick<RecordEditLocationProps, 'onAddLocation'> & {
    onAdded: (location: Location) => void;
  }
> = ({ onAddLocation, onAdded }) => {
  const { t } = useLocale();
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const add = async (): Promise<void> => {
    setBusy(true);
    setError('');
    try {
      onAdded(await onAddLocation(label.trim()));
      setLabel('');
    } catch {
      setError(t('error'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ gap: 8 }}>
      <FormField
        testID="record-edit-location-new"
        label={t('newLocation')}
        value={label}
        onChangeText={setLabel}
      />
      <ActionButton
        secondary
        testID="record-edit-location-add"
        label={t('addLocation')}
        disabled={busy || !label.trim()}
        onPress={() => void add()}
      />
      <FieldError testID="record-edit-location-new-error" error={error} />
    </View>
  );
};

/**
 * edits the general location and the detailed location as two separate fields
 * @param props section properties
 * @param props.draft form state
 * @param props.update writes form changes
 * @param props.locations the collector's general locations
 * @param props.onAddLocation saves a new general location label
 * @returns the location card
 */
export const RecordEditLocation: FC<RecordEditLocationProps> = ({
  draft,
  update,
  locations,
  onAddLocation,
}) => {
  const { t } = useLocale();

  return (
    <RecordEditCard testID="record-edit-location" title={t('location')}>
      <Text style={styles.label}>{t('generalLocation')}</Text>
      <ChoiceGroup
        label={t('generalLocation')}
        choices={[
          {
            value: notSet,
            label: t('locationNotSet'),
            testID: 'record-edit-location-none',
          },
          ...locations.map((location) => ({
            value: location.id,
            label: location.label,
            testID: `record-edit-location-option-${location.id}`,
          })),
        ]}
        selected={[draft.locationId ?? notSet]}
        onToggle={(value) => update({ locationId: value || null })}
      />
      <NewLocation
        onAddLocation={onAddLocation}
        onAdded={(location) => update({ locationId: location.id })}
      />
      <FormField
        testID="record-edit-field-location-detail"
        label={t('locationDetail')}
        value={draft.locationDetail}
        onChangeText={(locationDetail) => update({ locationDetail })}
      />
    </RecordEditCard>
  );
};
