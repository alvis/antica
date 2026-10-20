import { userEvent, within } from '@storybook/testing-library';

import { View } from 'react-native';

import { expect, fn } from 'storybook/test';

import { AskAssistantPill } from './AskAssistantPill.js';

import { theme } from './theme.js';

import type { Meta, StoryObj } from '@storybook/react-native-web-vite';

import type { AskAssistantPillProps } from './AskAssistantPill.js';

const meta = {
  title: 'Components/AskAssistantPill',
  component: AskAssistantPill,
  tags: ['autodocs'],
  args: { label: '問助理', onPress: (): void => undefined },
  argTypes: {
    variant: { control: 'inline-radio', options: ['light', 'onPhoto'] },
    expanded: { control: 'boolean' },
    disabled: { control: 'boolean' },
  },
  parameters: {
    docs: {
      description: {
        component:
          'The 48 dp 「鑑 問助理」 entry at the right end of every top bar; glass over photos',
      },
    },
  },
} satisfies Meta<typeof AskAssistantPill>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Light: Story = {
  args: { onPress: fn<AskAssistantPillProps['onPress']>() },
  play: async ({ args, canvasElement }) => {
    const pill = within(canvasElement).getByRole('button', {
      name: args.label,
    });

    await userEvent.click(pill);

    await expect(args.onPress).toHaveBeenCalledTimes(1);
  },
};

export const OnPhoto: Story = {
  args: { variant: 'onPhoto', onPress: fn<AskAssistantPillProps['onPress']>() },
  render: (args) => (
    <View style={{ backgroundColor: theme.color.photo.hero, padding: 16 }}>
      <AskAssistantPill {...args} />
    </View>
  ),
  play: Light.play,
};

export const Expanded: Story = {
  args: { expanded: true },
  play: async ({ args, canvasElement }) => {
    await expect(
      within(canvasElement).getByRole('button', { name: args.label }),
    ).toHaveAttribute('aria-expanded', 'true');
  },
};
