import { Text } from 'react-native';

import { styles } from '@antica/ui';

import { ChoiceGroup } from '../../../components/ChoiceGroup';
import { FieldError, FormField } from '../../../components/FormField';
import { useLocale } from '../../../providers/LocaleProvider';

import { RecordEditCard } from './RecordEditSection';

import type { FC } from 'react';

import type { RecordEditDraft } from '../record-edit-draft';

import type { RecordEditSectionProps } from './RecordEditSection';

/** a receipt the record can link, by its media identifier and file name */
export type ReceiptOption = { readonly id: string; readonly label: string };

/** properties for the acquisition and provenance card */
export type RecordEditAcquisitionProps = RecordEditSectionProps & {
  /** receipt media the record holds, plus any receipts it already links */
  receipts: readonly ReceiptOption[];
};

const textFields = [
  { key: 'seller', label: 'seller', id: 'seller' },
  { key: 'method', label: 'acquisitionMethod', id: 'method' },
] as const satisfies ReadonlyArray<{
  key: keyof RecordEditDraft;
  label: string;
  id: string;
}>;

/**
 * links or unlinks the record's receipt media
 * @param props receipt properties
 * @param props.draft form state
 * @param props.update writes form changes
 * @param props.receipts receipts the record can link
 * @returns the receipt choices, or a hint when the record holds none
 */
const ReceiptChoices: FC<
  Pick<RecordEditAcquisitionProps, 'draft' | 'update' | 'receipts'>
> = ({ draft, update, receipts }) => {
  const { t } = useLocale();

  return (
    <>
      <Text style={styles.label}>{t('receipt')}</Text>
      {receipts.length ? (
        <ChoiceGroup
          multiple
          label={t('receipt')}
          choices={receipts.map((receipt) => ({
            value: receipt.id,
            label: receipt.label,
            testID: `record-edit-receipt-${receipt.id}`,
          }))}
          selected={draft.receiptAssetIds}
          onToggle={(id) =>
            update({
              receiptAssetIds: draft.receiptAssetIds.includes(id)
                ? draft.receiptAssetIds.filter((item) => item !== id)
                : [...draft.receiptAssetIds, id],
            })
          }
        />
      ) : (
        <Text style={styles.secondary}>{t('noReceipts')}</Text>
      )}
    </>
  );
};

/**
 * edits acquisition and provenance; a purchase amount and currency are kept as a
 * historical transaction, never as a valuation
 * @param props section properties
 * @param props.draft form state
 * @param props.update writes form changes
 * @param props.errorOf translated validation error of a field
 * @param props.receipts receipts the record can link
 * @returns the acquisition card
 */
export const RecordEditAcquisition: FC<RecordEditAcquisitionProps> = ({
  draft,
  update,
  errorOf,
  receipts,
}) => {
  const { t } = useLocale();

  return (
    <RecordEditCard testID="record-edit-acquisition" title={t('acquisition')}>
      <FormField
        testID="record-edit-field-acquired-on"
        label={t('acquiredOn')}
        hint={t('dateFormatHint')}
        value={draft.acquiredOn}
        keyboardType="numbers-and-punctuation"
        error={errorOf('acquiredOn')}
        onChangeText={(acquiredOn) => update({ acquiredOn })}
      />
      {textFields.map((field) => (
        <FormField
          key={field.key}
          testID={`record-edit-field-${field.id}`}
          label={t(field.label)}
          value={draft[field.key]}
          onChangeText={(value) => update({ [field.key]: value })}
        />
      ))}
      <Text style={styles.secondary}>{t('purchaseHint')}</Text>
      <FormField
        testID="record-edit-field-purchase"
        label={t('purchaseAmount')}
        value={draft.amount}
        keyboardType="decimal-pad"
        onChangeText={(amount) => update({ amount })}
      />
      <FormField
        testID="record-edit-field-currency"
        label={t('currency')}
        hint={t('currencyHint')}
        value={draft.currency}
        autoCapitalize="characters"
        onChangeText={(currency) =>
          update({ currency: currency.toUpperCase() })
        }
      />
      <FieldError
        testID="record-edit-field-purchase-error"
        error={errorOf('purchase')}
      />
      <FormField
        testID="record-edit-field-provenance-note"
        label={t('provenanceNote')}
        value={draft.provenanceNote}
        multiline
        onChangeText={(provenanceNote) => update({ provenanceNote })}
      />
      <ReceiptChoices draft={draft} update={update} receipts={receipts} />
    </RecordEditCard>
  );
};
