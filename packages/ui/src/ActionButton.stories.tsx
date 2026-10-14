import { userEvent, within } from '@storybook/testing-library';

import { useState } from 'react';
import { Text, View } from 'react-native';

import { expect, fn } from 'storybook/test';

import { ActionButton } from './ActionButton.js';

import { styles } from './theme.js';

import type { Meta, StoryObj } from '@storybook/react-native-web-vite';

import type { FC } from 'react';

import type { ActionButtonProps } from './ActionButton.js';
import type {
  ActionInteractions,
  LoadedInteractions,
} from './ui.stories.helpers.js';

const meta = {
  title: 'Components/ActionButton',
  component: ActionButton,
  tags: ['autodocs'],
  excludeStories: ['createDomActionInteractions'],
  args: {
    label: 'Save item',
  },
  argTypes: {
    label: { control: 'text', description: 'Visible and spoken action label' },
    onPress: {
      control: false,
      description: 'Called when the action is pressed',
    },
    disabled: { control: 'boolean', description: 'Prevents interaction' },
    secondary: { control: 'boolean', description: 'Uses the outlined style' },
  },
  parameters: {
    docs: {
      description: {
        component:
          'Accessible collection action with primary and secondary styles',
      },
    },
  },
} satisfies Meta<typeof ActionButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {
  args: { onPress: fn<ActionButtonProps['onPress']>() },
  render: (args) => <ActionDemo {...args} />,
  play: async ({ args, canvasElement, loaded }) => {
    const {
      interactions: suppliedInteractions,
    }: LoadedInteractions<ActionInteractions> = loaded;
    const interactions =
      suppliedInteractions ??
      createDomActionInteractions(canvasElement, args.label);

    await interactions.expectEnabled();
    await interactions.press();

    await interactions.expectCallCount(args.onPress, 1);
    await interactions.expectVisibleText('Pressed 1 times');
  },
};

export const Secondary: Story = {
  args: { secondary: true, onPress: fn<ActionButtonProps['onPress']>() },
  render: (args) => <ActionDemo {...args} />,
  play: Primary.play,
};

export const Disabled: Story = {
  args: { disabled: true, onPress: fn<ActionButtonProps['onPress']>() },
  render: (args) => <ActionDemo {...args} />,
  play: async ({ args, canvasElement, loaded }) => {
    const {
      interactions: suppliedInteractions,
    }: LoadedInteractions<ActionInteractions> = loaded;
    const interactions =
      suppliedInteractions ??
      createDomActionInteractions(canvasElement, args.label);

    await interactions.expectDisabled();
    await interactions.attemptDisabledPress();

    await interactions.expectCallCount(args.onPress, 0);
    await interactions.expectVisibleText('Pressed 0 times');
  },
};

const demoStyle = { gap: 12, padding: 24 };

/**
 * shows button presses in the canvas so enabled and disabled states are observable
 * @param props story button properties
 * @returns interactive button and press count
 */
const ActionDemo: FC<Readonly<ActionButtonProps>> = (props) => {
  const [pressCount, setPressCount] = useState(0);

  return (
    <View style={demoStyle}>
      <ActionButton
        {...props}
        onPress={() => {
          props.onPress();
          setPressCount((current) => current + 1);
        }}
      />
      <Text style={styles.body}>Pressed {pressCount} times</Text>
    </View>
  );
};

/**
 * binds action story operations to the actual DOM canvas
 * @param canvasElement rendered story canvas
 * @param label accessible action label
 * @returns DOM interactions and observable assertions
 */
export const createDomActionInteractions = (
  canvasElement: HTMLElement,
  label: string,
): ActionInteractions => {
  const canvas = within(canvasElement);
  const button = canvas.getByRole('button', { name: label });

  return {
    expectEnabled: async () => {
      await expect(button).not.toHaveAttribute('aria-disabled', 'true');
    },
    expectDisabled: async () => {
      await expect(button).toHaveAttribute('aria-disabled', 'true');
    },
    press: async () => {
      await userEvent.click(button);
    },
    attemptDisabledPress: async () => {
      await userEvent.click(button, { pointerEventsCheck: 0 });
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
