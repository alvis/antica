import { Text, View } from 'react-native';

import { ActionButton, TextField, styles } from '@antica/ui';

import { useLocale } from '../../../providers/LocaleProvider';

import type { FC } from 'react';

import type { KnowledgeEntryDetailV2 } from '@antica/contracts';

import type { useKnowledgeEntry } from '../hooks/useKnowledgeEntry';

type EditorProps = ReturnType<typeof useKnowledgeEntry> & {
  entry: KnowledgeEntryDetailV2;
};
/**
 * offers an explicit editor and review/save action
 * @param props retained editor state and current entry
 * @returns editing controls
 */
export const KnowledgeEditor: FC<EditorProps> = (props) => {
  const { entry, editor, setEditor, save } = props;
  const { t } = useLocale();

  return (
    <>
      {!editor.editing && (
        <ActionButton
          testID="knowledge-edit"
          label={t('editDetails')}
          onPress={() =>
            setEditor((previous) => ({
              ...previous,
              editing: true,
              status: 'idle',
            }))
          }
          secondary
        />
      )}
      {editor.editing && (
        <View style={styles.card}>
          <TextField
            label={t('knowledgeEditTitle')}
            value={editor.title ?? entry.content.titles[0].text}
            onChangeText={(value) =>
              setEditor((previous) => ({
                ...previous,
                title: value,
                status: 'idle',
              }))
            }
            editable={editor.status !== 'busy'}
          />
          <TextField
            label={t('summary')}
            value={editor.summary ?? entry.content.sections.summary.text}
            onChangeText={(value) =>
              setEditor((previous) => ({
                ...previous,
                summary: value,
                status: 'idle',
              }))
            }
            multiline
            editable={editor.status !== 'busy'}
          />
        </View>
      )}
      <ActionButton
        testID="knowledge-save"
        label={t(editor.status === 'busy' ? 'saving' : 'knowledgeReviewSave')}
        disabled={editor.status === 'busy' || editor.status === 'conflict'}
        onPress={() => {
          void save();
        }}
      />
      <KnowledgeSaveFeedback {...props} />
    </>
  );
};
/**
 * keeps typed content visible through failures and explicit conflict reload
 * @param props retained editor and read query
 * @param props.editor retained editing and save state
 * @param props.reload fetches the working revision for explicit review
 * @returns review/save feedback
 */
const KnowledgeSaveFeedback: FC<EditorProps> = ({ editor, reload }) => {
  const { t } = useLocale();

  return (
    <>
      {editor.status === 'error' && (
        <Text
          testID="knowledge-save-error"
          accessibilityRole="alert"
          style={styles.error}>
          {t('knowledgeSaveError')}
        </Text>
      )}
      {editor.status === 'conflict' && (
        <View testID="knowledge-save-conflict">
          <Text accessibilityRole="alert" style={styles.error}>
            {t('knowledgeSaveConflict')}
          </Text>
          <ActionButton
            label={t('knowledgeReload')}
            onPress={() => {
              void reload();
            }}
          />
        </View>
      )}
      {editor.status === 'success' && (
        <Text
          testID="knowledge-save-success"
          accessibilityLiveRegion="polite"
          style={styles.body}>
          {t('knowledgeSavedSuccess')}
        </Text>
      )}
    </>
  );
};
