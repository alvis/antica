import { userEvent, within } from '@storybook/testing-library';

import { Text } from 'react-native';

import { expect, fn } from 'storybook/test';

import { Badge } from './Badge.js';
import { Card } from './Card.js';

import { styles } from './theme.js';

import type { Meta, StoryObj } from '@storybook/react-native-web-vite';

import type { CardProps } from './Card.js';

const meta = {
  title: 'Components/Card',
  component: Card,
  tags: ['autodocs'],
  args: {
    children: (
      <>
        <Badge label="2 項修改待確認" tone="danger" />
        <Text style={styles.heading}>黃花梨圈椅</Text>
        <Text style={styles.secondary}>
          助理想改「名稱」與「材質」，請在對話裡逐項確認。
        </Text>
      </>
    ),
  },
  parameters: { layout: 'padded' },
} satisfies Meta<typeof Card>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Static: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByText('黃花梨圈椅')).toBeVisible();
    await expect(canvas.queryByRole('button')).toBeNull();
  },
};

export const Pressable: Story = {
  args: {
    accessibilityLabel: '黃花梨圈椅',
    onPress: fn<NonNullable<CardProps['onPress']>>(),
  },
  play: async ({ args, canvasElement }) => {
    await userEvent.click(
      within(canvasElement).getByRole('button', { name: '黃花梨圈椅' }),
    );

    await expect(args.onPress).toHaveBeenCalledTimes(1);
  },
};
