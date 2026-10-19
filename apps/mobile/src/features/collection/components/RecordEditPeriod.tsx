import { Text } from 'react-native';

import { styles } from '@antica/ui';

import { ChoiceGroup } from '../../../components/ChoiceGroup';
import { FieldError, FormField } from '../../../components/FormField';
import { useLocale } from '../../../providers/LocaleProvider';

import { RecordEditCard } from './RecordEditSection';

import type { FC } from 'react';

import type { PeriodStatus } from '../record-edit-draft';

import type { RecordEditSectionProps } from './RecordEditSection';

const periodStatuses = [
  { value: 'collectorClaim', key: 'periodCollectorClaim' },
  { value: 'unconfirmed', key: 'periodUnconfirmed' },
] as const;

/**
 * edits the candidate period, labelled as the collector's own judgment, and the collector's written judgment
 * @param props section properties
 * @param props.draft form state
 * @param props.update writes form changes
 * @param props.errorOf translated validation error of a field
 * @returns the period card
 */
export const RecordEditPeriod: FC<RecordEditSectionProps> = ({
  draft,
  update,
  errorOf,
}) => {
  const { t } = useLocale();

  return (
    <RecordEditCard testID="record-edit-period" title={t('period')}>
      <Text style={styles.secondary}>{t('periodHint')}</Text>
      <FormField
        testID="record-edit-field-period"
        label={t('periodLabel')}
        value={draft.periodLabel}
        onChangeText={(periodLabel) => update({ periodLabel })}
      />
      <FormField
        testID="record-edit-field-period-from"
        label={t('periodFromYear')}
        value={draft.periodFrom}
        keyboardType="numbers-and-punctuation"
        onChangeText={(periodFrom) => update({ periodFrom })}
      />
      <FormField
        testID="record-edit-field-period-to"
        label={t('periodToYear')}
        value={draft.periodTo}
        keyboardType="numbers-and-punctuation"
        onChangeText={(periodTo) => update({ periodTo })}
      />
      <FieldError
        testID="record-edit-field-period-error"
        error={errorOf('period')}
      />
      <Text style={styles.label}>{t('periodSource')}</Text>
      <ChoiceGroup
        label={t('periodSource')}
        choices={periodStatuses.map((status) => ({
          value: status.value,
          label: t(status.key),
          testID: `record-edit-period-status-${status.value}`,
        }))}
        selected={[draft.periodStatus]}
        onToggle={(value) => update({ periodStatus: value as PeriodStatus })}
      />
      <FormField
        testID="record-edit-field-collector-judgment"
        label={t('collectorJudgment')}
        value={draft.collectorJudgment}
        multiline
        onChangeText={(collectorJudgment) => update({ collectorJudgment })}
      />
    </RecordEditCard>
  );
};
