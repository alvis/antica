import { Pressable, Text } from 'react-native';

import { styles } from '@antica/ui';

import type { FC } from 'react';

/** a selectable button with semantics on the actual focusable control */
export interface KnowledgeChoiceProps {
  label: string;
  selected: boolean;
  onPress: () => void;
  testID?: string;
}

/**
 * presents a wrapping, accessible choice using the shared button styles
 * @param props choice label, selection and action
 * @returns a selectable button
 */
export const KnowledgeChoice: FC<KnowledgeChoiceProps> = (props) => (
  <Pressable
    testID={props.testID}
    accessibilityRole="button"
    accessibilityLabel={props.label}
    accessibilityState={{ selected: props.selected }}
    onPress={props.onPress}
    style={[
      props.selected ? styles.button : styles.secondaryButton,
      { minHeight: 48, justifyContent: 'center' },
    ]}>
    <Text
      style={props.selected ? styles.buttonText : styles.secondaryButtonText}>
      {props.label}
    </Text>
  </Pressable>
);
