import { useState } from 'react';
import { Text, View } from 'react-native';

import { TextField } from './TextField.js';

import { styles } from './theme.js';

import type { Meta, StoryObj } from '@storybook/react-native-web-vite';

import type { ReactElement } from 'react';

import type { TextFieldProps } from './TextField.js';

const meta = {
  title: 'Components/TextField',
  component: TextField,
  args: {
    label: 'Collector note',
    value: 'A short observation',
    onChangeText: () => undefined,
  },
} satisfies Meta<typeof TextField>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Keeps the field controlled while displaying the value received from edits.
 * @param props Story field properties.
 * @returns Interactive field and current value.
 */
function FieldDemo(props: Readonly<TextFieldProps>): ReactElement {
  const [value, setValue] = useState(props.value);

  return (
    <View style={{ gap: 12, padding: 24 }}>
      <TextField {...props} value={value} onChangeText={setValue} />
      <Text style={styles.body}>Current value: {value}</Text>
    </View>
  );
}

export const SingleLine: Story = {
  render: (args) => <FieldDemo {...args} />,
};

export const Multiline: Story = {
  args: { multiline: true, value: 'Line one\nLine two' },
  render: (args) => <FieldDemo {...args} />,
};

export const ReadOnly: Story = {
  args: { editable: false, value: 'Saved observation' },
  render: (args) => <FieldDemo {...args} />,
};
