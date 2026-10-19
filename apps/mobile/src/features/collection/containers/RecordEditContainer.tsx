import { useQueryClient } from '@tanstack/react-query';

import { useRouter } from 'expo-router';

import { useEffect, useMemo, useRef } from 'react';

import { Text, View } from 'react-native';

import { locationSchema } from '@antica/contracts';
import { ActionButton, styles } from '@antica/ui';

import { QueryState } from '../../../components/QueryState';
import { Screen } from '../../../components/Screen';
import { useAuth } from '../../../providers/AuthProvider';
import { useLocale } from '../../../providers/LocaleProvider';

import { RecordEditAcquisition } from '../components/RecordEditAcquisition';
import { RecordEditBasics } from '../components/RecordEditBasics';
import { RecordEditConflict } from '../components/RecordEditConflict';
import { RecordEditLocation } from '../components/RecordEditLocation';
import { RecordEditMeasurements } from '../components/RecordEditMeasurements';
import { RecordEditPeriod } from '../components/RecordEditPeriod';
import { useRecordEdit } from '../hooks/useRecordEdit';
import { useRecordFieldLabels } from '../hooks/useRecordFieldLabels';
import { draftFromRecord } from '../record-edit-draft';

import type { FC, PropsWithChildren } from 'react';

import type { ScrollView } from 'react-native';

import type { Location } from '@antica/contracts';

import type { RecordEdit } from '../hooks/useRecordEdit';
import type { RecordFieldLabels } from '../hooks/useRecordFieldLabels';
import type { RecordEditDraft } from '../record-edit-draft';

/** properties for the manual record editor */
export type RecordEditContainerProps = {
  recordId: string;
  /** told whether the form holds unsaved changes, so leaving can ask first */
  onDirtyChange?: (dirty: boolean) => void;
};

/** properties for the editor's field sections */
type EditorFieldsProps = {
  edit: RecordEdit;
  draft: RecordEditDraft;
  lookups: RecordFieldLabels;
  onAddLocation: (label: string) => Promise<Location>;
};

/**
 * lays out every editable field of the record in its section
 * @param props field properties
 * @param props.edit editor state and operations
 * @param props.draft form state
 * @param props.lookups label lookups and options
 * @param props.onAddLocation saves a new general location label
 * @returns the editor's sections
 */
const EditorFields: FC<EditorFieldsProps> = ({
  edit,
  draft,
  lookups,
  onAddLocation,
}) => {
  const { t } = useLocale();
  const section = {
    draft,
    update: edit.update,
    errorOf: (field: keyof typeof edit.errors) => {
      const key = edit.errors[field];

      return key && t(key);
    },
  };
  const receiptIds = new Set([
    ...lookups.media
      .filter((item) => item.asset.purpose === 'receipt')
      .map((item) => item.asset.id),
    ...draft.receiptAssetIds,
  ]);

  return (
    <>
      <RecordEditBasics
        {...section}
        knowledgeLabel={lookups.labels.knowledge}
      />
      <RecordEditPeriod {...section} />
      <RecordEditMeasurements {...section} />
      <RecordEditAcquisition
        {...section}
        receipts={[...receiptIds].map((id) => ({
          id,
          label: lookups.labels.media(id),
        }))}
      />
      <RecordEditLocation
        {...section}
        locations={lookups.locations ?? []}
        onAddLocation={onAddLocation}
      />
    </>
  );
};

/**
 * keeps the form read-only while a save runs, so nothing typed meanwhile is
 * dropped by the save; the wrapper is never flattened, since Android cannot
 * re-parent the form when locking would turn a layout-only view into a real one
 * @param props lock properties
 * @param props.locked whether a save is running
 * @param props.children the form
 * @returns the form, locked while saving
 */
const SaveLock: FC<PropsWithChildren<{ locked: boolean }>> = ({
  locked,
  children,
}) => (
  <View
    testID="record-edit-fields"
    collapsable={false}
    pointerEvents={locked ? 'none' : 'auto'}
    accessibilityState={{ disabled: locked }}
    style={{ gap: styles.content.gap }}>
    {children}
  </View>
);

/**
 * reads the labels of everything the form and the conflict view refer to
 * @param edit editor state
 * @returns the latest record as a form, when in conflict, and the label lookups
 */
function useEditorLookups(edit: RecordEdit): {
  latest: RecordEditDraft | null;
  lookups: ReturnType<typeof useRecordFieldLabels>;
} {
  const draft = edit.session?.draft;
  const latest = useMemo(
    () => edit.conflict && draftFromRecord(edit.conflict.latest),
    [edit.conflict],
  );
  const lookups = useRecordFieldLabels({
    knowledgeIds: [draft, latest].flatMap((item) =>
      item ? [...item.categoryIds, ...item.materialIds] : [],
    ),
    mediaIds: edit.session?.base.mediaIds ?? [],
  });

  return { latest, lookups };
}

/**
 * creates a general location the collector names while editing
 * @returns an action that saves the location and refreshes the location list
 */
function useAddLocation(): (label: string) => Promise<Location> {
  const { api } = useAuth();
  const queryClient = useQueryClient();

  return async (label) => {
    const location = await api.post('/v1/locations', locationSchema, {
      body: { label },
    });
    await queryClient.invalidateQueries({ queryKey: ['locations'] });

    return location;
  };
}

/**
 * edits one record by hand; only the changed fields are saved, against the
 * revision the edit started from, and a field another writer changed is never overwritten silently
 * @param props screen properties
 * @param props.recordId record to edit
 * @param props.onDirtyChange told whether the form holds unsaved changes
 * @returns the record editor screen
 */
export const RecordEditContainer: FC<RecordEditContainerProps> = ({
  recordId,
  onDirtyChange,
}) => {
  const router = useRouter();
  const { t } = useLocale();
  const scrollRef = useRef<ScrollView>(null);
  const addLocation = useAddLocation();
  const edit = useRecordEdit(recordId, () => onDirtyChange?.(false));
  const draft = edit.session?.draft;
  const { latest, lookups } = useEditorLookups(edit);
  const dirty = edit.changed.length > 0;
  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);
  useEffect(() => {
    if (edit.conflict) {
      // the conflict view sits on top, so bring it into sight
      scrollRef.current?.scrollTo({ y: 0, animated: true });
    }
  }, [edit.conflict]);

  return (
    <Screen
      title={t('editRecord')}
      subtitle={edit.record.data?.code}
      scrollRef={scrollRef}>
      <QueryState
        loading={!edit.session && !edit.record.error}
        error={edit.session ? null : edit.record.error}
        retry={() => void edit.record.refetch()}>
        {draft && (
          <View testID="record-edit" style={{ gap: styles.content.gap }}>
            {edit.conflict && latest && (
              <RecordEditConflict
                fields={edit.conflict.fields}
                mine={draft}
                current={latest}
                choices={edit.conflict.choices}
                labels={lookups.labels}
                onChoose={edit.choose}
                onSave={() => void edit.resolve()}
              />
            )}
            <SaveLock locked={edit.saving}>
              <EditorFields
                edit={edit}
                draft={draft}
                lookups={lookups}
                onAddLocation={addLocation}
              />
            </SaveLock>
            <EditorActions edit={edit} onCancel={() => router.back()} />
          </View>
        )}
      </QueryState>
    </Screen>
  );
};

/**
 * shows the save outcome and the save and cancel actions
 * @param props action properties
 * @param props.edit editor state and operations
 * @param props.onCancel leaves the editor, asking first when changes are unsaved
 * @returns the editor's footer
 */
const EditorActions: FC<{ edit: RecordEdit; onCancel: () => void }> = ({
  edit,
  onCancel,
}) => {
  const { t } = useLocale();
  const messages = [
    Object.keys(edit.errors).length
      ? { id: 'record-edit-invalid', text: t('editHasErrors') }
      : null,
    edit.changedAgain
      ? { id: 'record-edit-changed-again', text: t('recordChangedAgain') }
      : null,
    edit.failure ? { id: 'record-edit-error', text: edit.failure } : null,
  ].flatMap((item) => (item ? [item] : []));

  return (
    <View style={{ gap: styles.card.gap }}>
      {messages.map((message) => (
        <Text
          key={message.id}
          testID={message.id}
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          style={styles.error}>
          {message.text}
        </Text>
      ))}
      {!edit.conflict && (
        <ActionButton
          testID="record-edit-save"
          label={edit.saving ? t('saving') : t('save')}
          disabled={edit.saving}
          onPress={() => void edit.save()}
        />
      )}
      <ActionButton
        secondary
        testID="record-edit-cancel"
        label={t('cancel')}
        onPress={onCancel}
      />
    </View>
  );
};
