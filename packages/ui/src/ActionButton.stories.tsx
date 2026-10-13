import { useState } from 'react';
import { Text, View } from 'react-native';

import { ActionButton } from './ActionButton.js';

import { styles } from './theme.js';

import type { Meta, StoryObj } from '@storybook/react-native-web-vite';

import type { ReactElement } from 'react';

import type { ActionButtonProps } from './ActionButton.js';

const meta = {
  title: 'Components/ActionButton',
  component: ActionButton,
  args: {
    label: 'Save item',
    onPress: () => undefined,
  },
} satisfies Meta<typeof ActionButton>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Shows button presses in the canvas so enabled and disabled states are observable.
 * @param props Story button properties.
 * @returns Interactive button and press count.
 */
function ActionDemo(props: Readonly<ActionButtonProps>): ReactElement {
  const [pressCount, setPressCount] = useState(0);

  return (
    <View style={{ gap: 12, padding: 24 }}>
      <ActionButton
        {...props}
        onPress={() => setPressCount((current) => current + 1)}
      />
      <Text style={styles.body}>Pressed {pressCount} times</Text>
    </View>
  );
}

export const Primary: Story = {
  render: (args) => <ActionDemo {...args} />,
};

export const Secondary: Story = {
  args: { secondary: true },
  render: (args) => <ActionDemo {...args} />,
};

export const Disabled: Story = {
  args: { disabled: true },
  render: (args) => <ActionDemo {...args} />,
};
