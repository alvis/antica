import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { ActionButton, colors, styles, theme } from '@antica/ui';

import { useLocale } from '../../../providers/LocaleProvider';

import { wholeRecord } from '../capture-grid';

import type { FC } from 'react';

export type CaptureLabelPickerProps = {
  /** component labels already used in the record or this draft */
  used: string[];
  /** spoken and visible name of the file being labelled, such as Photo 3 */
  item: string;
  /** the file's current label, empty when it has none */
  current: string;
  onPick: (label: string) => void;
  onCancel: () => void;
};

const layout = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(23, 61, 53, 0.4)',
  },
  sheet: {
    maxHeight: '90%',
    backgroundColor: colors.canvas,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  sheetContent: { padding: 16, paddingBottom: 32, gap: 12 },
  option: {
    minHeight: 48,
    minWidth: 48,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: colors.jade,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionText: {
    color: colors.jade,
    fontSize: 16,
    ...theme.font.face('sans', '600'),
  },
  chosen: { backgroundColor: colors.jade },
  chosenText: { color: colors.card },
});

/**
 * renders one label to pick, checked when it is the file's current label
 * @param props option content and handler
 * @param props.testID automation identifier
 * @param props.value label the file gets
 * @param props.name spoken and visible name of the label
 * @param props.current file's current label
 * @param props.onPick gives the file the label
 * @returns the radio button
 */
const LabelOption: FC<{
  testID: string;
  value: string;
  name: string;
  current: string;
  onPick: (label: string) => void;
}> = ({ testID, value, name, current, onPick }) => {
  const checked = value === current;

  return (
    <Pressable
      testID={testID}
      accessibilityRole="radio"
      accessibilityLabel={name}
      accessibilityState={{ checked }}
      onPress={() => onPick(value)}
      style={[layout.option, checked && layout.chosen]}>
      <Text style={[layout.optionText, checked && layout.chosenText]}>
        {name}
      </Text>
    </Pressable>
  );
};

/**
 * offers the whole record first, then the component labels already used
 * @param props labels on offer and handler
 * @param props.used component labels already used
 * @param props.current file's current label
 * @param props.onPick gives the file a label
 * @returns the label radio buttons
 */
const LabelChoices: FC<{
  used: string[];
  current: string;
  onPick: (label: string) => void;
}> = ({ used, current, onPick }) => {
  const { t } = useLocale();

  return (
    <>
      <View style={styles.row}>
        <LabelOption
          testID="capture-label-whole"
          value={wholeRecord}
          name={t('labelWholeRecord')}
          current={current}
          onPick={onPick}
        />
      </View>
      {used.length > 0 && (
        <View style={{ gap: 8 }}>
          <Text style={styles.label}>{t('labelUsed')}</Text>
          <View style={styles.row}>
            {used.map((label, index) => (
              <LabelOption
                key={label}
                testID={`capture-label-used-${index + 1}`}
                value={label}
                name={label}
                current={current}
                onPick={onPick}
              />
            ))}
          </View>
        </View>
      )}
    </>
  );
};

/**
 * offers a new label: a button that opens a name field, then the field and its apply action
 * @param props entry state and handlers
 * @param props.typing the name field is open
 * @param props.onType opens the name field
 * @param props.onPick gives the file the typed label
 * @returns the new-label entry
 */
const NewLabel: FC<{
  typing: boolean;
  onType: () => void;
  onPick: (label: string) => void;
}> = ({ typing, onType, onPick }) => {
  const { t } = useLocale();
  const [name, setName] = useState('');

  return typing ? (
    <>
      <Text style={styles.label}>{t('labelNewName')}</Text>
      <TextInput
        testID="capture-label-new-input"
        accessibilityLabel={t('labelNewName')}
        autoFocus
        value={name}
        onChangeText={setName}
        onSubmitEditing={() => {
          if (name.trim()) {
            onPick(name);
          }
        }}
        style={styles.field}
      />
      <ActionButton
        testID="capture-label-apply"
        label={t('labelApply')}
        onPress={() => onPick(name)}
        disabled={!name.trim()}
      />
    </>
  ) : (
    <ActionButton
      testID="capture-label-new"
      label={t('labelNew')}
      onPress={onType}
      secondary
    />
  );
};

/**
 * lets the collector pick a label (B03): the whole record, a component label already used in
 * this item, or a new component label typed in
 * @param props labels on offer and handlers
 * @param props.used component labels already used in the record or draft
 * @param props.item name of the file being labelled
 * @param props.current file's current label
 * @param props.onPick gives the file a label; an empty label clears it
 * @param props.onCancel closes the picker unchanged
 * @returns the picker sheet
 */
export const CaptureLabelPicker: FC<CaptureLabelPickerProps> = ({
  used,
  item,
  current,
  onPick,
  onCancel,
}) => {
  const { t } = useLocale();
  // while a new label is typed, only its field stays so it fits above the keyboard
  const [typing, setTyping] = useState(false);

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onCancel}>
      {/* edge-to-edge Android no longer resizes the window for the soft keyboard,
          so the sheet is padded above it */}
      <KeyboardAvoidingView behavior="padding" style={layout.backdrop}>
        <ScrollView
          testID="capture-label-picker"
          keyboardShouldPersistTaps="handled"
          style={layout.sheet}
          contentContainerStyle={layout.sheetContent}>
          <Text accessibilityRole="header" style={styles.heading}>
            {t('component')}
          </Text>
          <Text style={styles.secondary}>{item}</Text>
          {!typing && (
            <LabelChoices used={used} current={current} onPick={onPick} />
          )}
          <NewLabel
            typing={typing}
            onType={() => setTyping(true)}
            onPick={onPick}
          />
          {!typing && Boolean(current) && (
            <ActionButton
              testID="capture-label-clear"
              label={t('labelClear')}
              onPress={() => onPick('')}
              secondary
            />
          )}
          <ActionButton
            testID="capture-label-cancel"
            label={t('cancel')}
            onPress={onCancel}
            secondary
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
};
