import { Text, View } from 'react-native';

import { ActionButton, TextField, styles } from '@antica/ui';

import { useLocale } from '../../../i18n/LocaleProvider';

import type { FC } from 'react';

import type { Location } from '@antica/contracts';

import type { CaptureDraft, EditableField } from '../hooks/useCaptureDraft';

export type CaptureDetailsStepProps = {
  draft: CaptureDraft;
  locations: Location[] | undefined;
  editField: (field: EditableField, value: string) => void;
  update: (patch: Partial<CaptureDraft>) => void;
  onReceipt: () => void;
  onContinue: () => void;
};

export const CaptureDetailsStep: FC<CaptureDetailsStepProps> = ({
  draft,
  locations,
  editField,
  update,
  onReceipt,
  onContinue,
}) => {
  const { t } = useLocale();

  return (
    <View style={styles.card}>
      <Text style={styles.heading}>
        {t('name')} / {t('location')}
      </Text>
      {/* the shared field takes no testID, so automation targets its wrapper */}
      <View testID="capture-details-name">
        <TextField
          label={t('name')}
          value={draft.name}
          onChangeText={(value) => editField('name', value)}
        />
      </View>
      <TextField
        label={t('typeTag')}
        value={draft.category}
        onChangeText={(value) => editField('category', value)}
      />
      <TextField
        label={t('heightWithUnit', { unit: draft.heightUnit })}
        value={draft.height}
        onChangeText={(value) => editField('height', value)}
        keyboardType="decimal-pad"
      />
      <View style={styles.row}>
        <ActionButton
          label="cm"
          onPress={() => update({ heightUnit: 'cm' })}
          secondary
        />
        <ActionButton
          label="mm"
          onPress={() => update({ heightUnit: 'mm' })}
          secondary
        />
      </View>
      <TextField
        label={t('location')}
        value={draft.locationLabel}
        onChangeText={(value) => editField('locationLabel', value)}
      />
      <View style={styles.row}>
        {locations?.map((location) => (
          <ActionButton
            key={location.id}
            label={location.label}
            onPress={() => editField('locationLabel', location.label)}
            secondary
          />
        ))}
      </View>
      <TextField
        label={t('locationDetail')}
        value={draft.locationDetail}
        onChangeText={(value) => editField('locationDetail', value)}
      />
      <ActionButton label={t('receipt')} onPress={onReceipt} secondary />
      <ActionButton
        testID="capture-details-continue"
        label={t('continue')}
        onPress={onContinue}
      />
    </View>
  );
};
