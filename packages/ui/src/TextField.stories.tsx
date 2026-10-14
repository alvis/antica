import { userEvent, within } from '@storybook/testing-library';

import { useState } from 'react';
import { Text, View } from 'react-native';

import { expect, fn } from 'storybook/test';

import { TextField } from './TextField.js';

import { styles } from './theme.js';

import type { Meta, StoryObj } from '@storybook/react-native-web-vite';

import type { FC } from 'react';

import type { TextFieldProps } from './TextField.js';
import type {
  FieldInteractions,
  LoadedInteractions,
} from './ui.stories.helpers.js';

const meta = {
  title: 'Components/TextField',
  component: TextField,
  tags: ['autodocs'],
  excludeStories: ['createDomFieldInteractions'],
  args: {
    label: 'Collector note',
    value: 'A short observation',
  },
  argTypes: {
    label: { control: 'text', description: 'Visible and spoken field label' },
    value: { control: 'text', description: 'Current controlled text' },
    onChangeText: { control: false, description: 'Receives edited text' },
    keyboardType: {
      control: 'select',
      options: [
        'default',
        'email-address',
        'numeric',
        'phone-pad',
        'number-pad',
        'decimal-pad',
        'url',
        'ascii-capable',
        'numbers-and-punctuation',
        'name-phone-pad',
        'twitter',
        'web-search',
        'visible-password',
      ],
      description: 'Native keyboard layout',
    },
    multiline: { control: 'boolean', description: 'Allows multiple lines' },
    editable: { control: 'boolean', description: 'Allows editing' },
    autoComplete: {
      control: 'select',
      options: ['one-time-code', 'tel', 'off'],
      description: 'Native autofill hint',
    },
  },
  parameters: {
    docs: {
      description: {
        component: 'Labeled controlled native text field for collection forms',
      },
    },
  },
} satisfies Meta<typeof TextField>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SingleLine: Story = {
  args: { onChangeText: fn<TextFieldProps['onChangeText']>() },
  render: (args) => <FieldDemo {...args} />,
  play: async ({ args, canvasElement, loaded }) => {
    const {
      interactions: suppliedInteractions,
    }: LoadedInteractions<FieldInteractions> = loaded;
    const interactions =
      suppliedInteractions ??
      createDomFieldInteractions(canvasElement, args.label);
    const updatedValue = 'Updated observation';

    await interactions.expectValue(args.value);
    await interactions.clear();
    await interactions.type(updatedValue);

    await interactions.expectLastChangedValue(args.onChangeText, updatedValue);
    await interactions.expectValue(updatedValue);
    await interactions.expectVisibleText(`Current value: ${updatedValue}`);
  },
};

export const Multiline: Story = {
  args: {
    multiline: true,
    value: 'Line one\nLine two',
    onChangeText: fn<TextFieldProps['onChangeText']>(),
  },
  render: (args) => <FieldDemo {...args} />,
  play: async ({ args, canvasElement, loaded }) => {
    const {
      interactions: suppliedInteractions,
    }: LoadedInteractions<FieldInteractions> = loaded;
    const interactions =
      suppliedInteractions ??
      createDomFieldInteractions(canvasElement, args.label);
    const updatedValue = 'Updated line one\nUpdated line two';

    await interactions.expectValue(args.value);
    await interactions.expectMultiline();
    await interactions.clear();
    await interactions.type(updatedValue);

    await interactions.expectLastChangedValue(args.onChangeText, updatedValue);
    await interactions.expectValue(updatedValue);
    await interactions.expectVisibleText(`Current value: ${updatedValue}`);
  },
};

export const ReadOnly: Story = {
  args: {
    editable: false,
    value: 'Saved observation',
    onChangeText: fn<TextFieldProps['onChangeText']>(),
  },
  render: (args) => <FieldDemo {...args} />,
  play: async ({ args, canvasElement, loaded }) => {
    const {
      interactions: suppliedInteractions,
    }: LoadedInteractions<FieldInteractions> = loaded;
    const interactions =
      suppliedInteractions ??
      createDomFieldInteractions(canvasElement, args.label);

    await interactions.expectReadOnly();
    await interactions.type('Attempted edit');

    await interactions.expectCallCount(args.onChangeText, 0);
    await interactions.expectValue(args.value);
    await interactions.expectVisibleText(`Current value: ${args.value}`);
  },
};

const demoStyle = { gap: 12, padding: 24 };

/**
 * keeps the field controlled while displaying the value received from edits
 * @param props story field properties
 * @returns interactive field and current value
 */
const FieldDemo: FC<Readonly<TextFieldProps>> = (props) => {
  const [value, setValue] = useState(props.value);

  return (
    <View style={demoStyle}>
      <TextField
        {...props}
        value={value}
        onChangeText={(nextValue) => {
          props.onChangeText(nextValue);
          setValue(nextValue);
        }}
      />
      <Text style={styles.body}>Current value: {value}</Text>
    </View>
  );
};

/**
 * binds controlled field story operations to the actual DOM canvas
 * @param canvasElement rendered story canvas
 * @param label accessible field label
 * @returns DOM interactions and observable assertions
 */
export const createDomFieldInteractions = (
  canvasElement: HTMLElement,
  label: string,
): FieldInteractions => {
  const canvas = within(canvasElement);
  const field = canvas.getByRole('textbox', { name: label });

  return {
    clear: async () => {
      await userEvent.clear(field);
    },
    type: async (text) => {
      await userEvent.type(field, text);
    },
    expectValue: async (value) => {
      await expect(field).toHaveValue(value);
    },
    expectReadOnly: async () => {
      await expect(field).toHaveAttribute('readonly');
    },
    expectMultiline: async () => {
      await expect(field.tagName).toBe('TEXTAREA');
    },
    expectLastChangedValue: async (callback, value) => {
      await expect(callback).toHaveBeenLastCalledWith(value);
    },
    expectCallCount: async (callback, count) => {
      await expect(callback).toHaveBeenCalledTimes(count);
    },
    expectVisibleText: async (text) => {
      await expect(
        canvas.getByText(text, { normalizer: (value) => value }),
      ).toBeVisible();
    },
  };
};
