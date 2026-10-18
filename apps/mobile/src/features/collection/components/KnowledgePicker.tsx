import { useQuery } from '@tanstack/react-query';

import { useState } from 'react';

import { Text, View } from 'react-native';

import { knowledgePageSchema } from '@antica/contracts';
import { styles } from '@antica/ui';

import { ChoiceGroup } from '../../../components/ChoiceGroup';
import { FormField } from '../../../components/FormField';
import { useAuth } from '../../../providers/AuthProvider';
import { useLocale } from '../../../providers/LocaleProvider';

import type { FC } from 'react';

import type { MessageKey } from '../../../i18n/messages';

/** knowledge entries an editor field selects from */
export type PickerKind = 'object_type' | 'material';

/** properties for choosing knowledge entries */
export type KnowledgePickerProps = {
  kind: PickerKind;
  label: string;
  /** chosen knowledge entry identifiers */
  selected: readonly string[];
  /** title of a chosen entry */
  labelOf: (id: string) => string;
  onChange: (ids: readonly string[]) => void;
  /** automation identifier prefix, such as `record-edit-field-category-ids` */
  testID: string;
};

const searchLabels = {
  object_type: 'searchObjectTypes',
  material: 'searchMaterials',
} as const satisfies Record<PickerKind, MessageKey>;

/** entries offered per search */
const optionLimit = 20;

/**
 * chooses object types or materials from the collector's knowledge entries,
 * which the API lists; nothing is chosen until the collector picks it
 * @param props picker properties
 * @param props.kind knowledge kind offered
 * @param props.label field name
 * @param props.selected chosen entry identifiers
 * @param props.labelOf title of a chosen entry
 * @param props.onChange receives the new selection
 * @param props.testID automation identifier prefix
 * @returns chosen entries, a search input, and matching entries
 */
export const KnowledgePicker: FC<KnowledgePickerProps> = ({
  kind,
  label,
  selected,
  labelOf,
  onChange,
  testID,
}) => {
  const { api } = useAuth();
  const { t } = useLocale();
  const [term, setTerm] = useState('');
  const query = new URLSearchParams({
    q: term.trim(),
    limit: String(optionLimit),
  });
  query.append('kinds', kind);
  const options = useQuery({
    queryKey: ['record-edit-knowledge', kind, term.trim()],
    queryFn: async ({ signal }) =>
      api.get(`/v1/knowledge?${query.toString()}`, knowledgePageSchema, signal),
  });
  const toggle = (id: string): void =>
    onChange(
      selected.includes(id)
        ? selected.filter((item) => item !== id)
        : [...selected, id],
    );
  const titles = new Map(
    options.data?.items.map((item) => [item.id, item.titleZhHant]),
  );
  const ids = [...new Set([...selected, ...titles.keys()])];

  return (
    <View style={{ gap: 8 }}>
      <Text style={styles.label}>{label}</Text>
      <FormField
        testID={`${testID}-search`}
        label={t(searchLabels[kind])}
        value={term}
        onChangeText={setTerm}
      />
      {ids.length ? (
        <ChoiceGroup
          multiple
          label={label}
          choices={ids.map((id) => ({
            value: id,
            label: titles.get(id) ?? labelOf(id),
            testID: `${testID}-option-${id}`,
          }))}
          selected={selected}
          onToggle={toggle}
        />
      ) : (
        <Text style={styles.secondary}>{t('noKnowledgeOptions')}</Text>
      )}
    </View>
  );
};
