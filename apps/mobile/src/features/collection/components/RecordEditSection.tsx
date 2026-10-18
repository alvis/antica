import { Text, View } from 'react-native';

import { styles } from '@antica/ui';

import type { FC, PropsWithChildren } from 'react';

import type { RecordEditDraft, RecordEditField } from '../record-edit-draft';

/** what every editor section receives */
export type RecordEditSectionProps = {
  draft: RecordEditDraft;
  update: (patch: Partial<RecordEditDraft>) => void;
  /** translated validation error of a field, if it has one */
  errorOf: (field: RecordEditField) => string | undefined;
};

/** properties for one titled group of editor fields */
export type RecordEditCardProps = PropsWithChildren<{
  title: string;
  testID: string;
}>;

/**
 * groups related editor fields under a heading
 * @param props card properties
 * @param props.title heading of the group
 * @param props.testID automation identifier of the group
 * @param props.children fields of the group
 * @returns the titled card
 */
export const RecordEditCard: FC<RecordEditCardProps> = ({
  title,
  testID,
  children,
}) => (
  <View testID={testID} style={styles.card}>
    <Text accessibilityRole="header" style={styles.heading}>
      {title}
    </Text>
    {children}
  </View>
);
