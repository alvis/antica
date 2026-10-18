import { useState } from 'react';

import { Text, View } from 'react-native';

import { ActionButton, styles } from '@antica/ui';

import { ChoiceGroup } from '../../../components/ChoiceGroup';
import { FormField } from '../../../components/FormField';
import { useLocale } from '../../../providers/LocaleProvider';

import { KnowledgePicker } from './KnowledgePicker';
import { RecordEditCard } from './RecordEditSection';

import type { FC } from 'react';

import type { RecordEditSectionProps } from './RecordEditSection';

/** properties for the basic information card */
export type RecordEditBasicsProps = RecordEditSectionProps & {
  /** title of an object-type or material knowledge entry */
  knowledgeLabel: (id: string) => string;
};

/**
 * edits the feature tags: each chosen tag can be removed, and a typed tag added
 * @param props section properties
 * @param props.draft form state
 * @param props.update writes form changes
 * @returns the tag choices and the new-tag input
 */
const TagsField: FC<Pick<RecordEditSectionProps, 'draft' | 'update'>> = ({
  draft,
  update,
}) => {
  const { t } = useLocale();
  const [tag, setTag] = useState('');
  const add = (): void => {
    const value = tag.trim();
    if (!draft.tags.includes(value)) {
      update({ tags: [...draft.tags, value] });
    }
    setTag('');
  };

  return (
    <View style={{ gap: 8 }}>
      <Text style={styles.label}>{t('tags')}</Text>
      {draft.tags.length > 0 && (
        <ChoiceGroup
          multiple
          label={t('tags')}
          choices={draft.tags.map((value) => ({
            value,
            label: value,
            accessibilityLabel: t('removeValue', { value }),
            testID: `record-edit-tag-${value}`,
          }))}
          selected={draft.tags}
          onToggle={(value) =>
            update({ tags: draft.tags.filter((item) => item !== value) })
          }
        />
      )}
      <FormField
        testID="record-edit-field-tags"
        label={t('newTag')}
        value={tag}
        onChangeText={setTag}
      />
      <ActionButton
        secondary
        testID="record-edit-tag-add"
        label={t('addTag')}
        disabled={!tag.trim()}
        onPress={add}
      />
    </View>
  );
};

/**
 * edits the name, object type, materials, piece count, tags, and notes
 * @param props section properties
 * @param props.draft form state
 * @param props.update writes form changes
 * @param props.errorOf translated validation error of a field
 * @param props.knowledgeLabel title of a knowledge entry
 * @returns the basic information card
 */
export const RecordEditBasics: FC<RecordEditBasicsProps> = ({
  draft,
  update,
  errorOf,
  knowledgeLabel,
}) => {
  const { t } = useLocale();

  return (
    <RecordEditCard testID="record-edit-basics" title={t('editBasics')}>
      <FormField
        testID="record-edit-field-name"
        label={t('name')}
        value={draft.name}
        onChangeText={(name) => update({ name })}
      />
      <KnowledgePicker
        kind="object_type"
        testID="record-edit-field-category-ids"
        label={t('type')}
        selected={draft.categoryIds}
        labelOf={knowledgeLabel}
        onChange={(categoryIds) => update({ categoryIds })}
      />
      <KnowledgePicker
        kind="material"
        testID="record-edit-field-material-ids"
        label={t('material')}
        selected={draft.materialIds}
        labelOf={knowledgeLabel}
        onChange={(materialIds) => update({ materialIds })}
      />
      <FormField
        testID="record-edit-field-piece-count"
        label={t('pieceCount')}
        value={draft.pieceCount}
        keyboardType="number-pad"
        error={errorOf('pieceCount')}
        onChangeText={(pieceCount) => update({ pieceCount })}
      />
      <TagsField draft={draft} update={update} />
      <FormField
        testID="record-edit-field-description"
        label={t('descriptionAndNotes')}
        value={draft.description}
        multiline
        onChangeText={(description) => update({ description })}
      />
    </RecordEditCard>
  );
};
