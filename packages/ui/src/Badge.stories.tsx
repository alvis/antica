import { within } from '@storybook/testing-library';

import { View } from 'react-native';

import { expect } from 'storybook/test';

import { Badge } from './Badge.js';

import { theme } from './theme.js';

import type { Meta, StoryObj } from '@storybook/react-native-web-vite';

const meta = {
  title: 'Components/Badge',
  component: Badge,
  tags: ['autodocs'],
  args: { label: '需要補拍', tone: 'warning' },
  argTypes: {
    tone: {
      control: 'select',
      options: [
        'accent',
        'warning',
        'danger',
        'neutral',
        'assistant',
        'onPhoto',
      ],
    },
  },
} satisfies Meta<typeof Badge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Tones: Story = {
  render: () => (
    <View style={{ gap: 8, padding: 16, backgroundColor: theme.color.bg.page }}>
      <Badge label="查驗" tone="neutral" />
      <Badge label="6 項建議" tone="accent" />
      <Badge label="需要補拍" tone="warning" />
      <Badge label="2 項修改待確認" tone="danger" />
      <Badge label="助理" tone="assistant" />
    </View>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    for (const label of ['查驗', '6 項建議', '需要補拍', '2 項修改待確認']) {
      await expect(canvas.getByText(label)).toBeVisible();
    }
  },
};

export const OnPhoto: Story = {
  args: { label: '館藏實例', tone: 'onPhoto' },
  render: (args) => (
    <View style={{ padding: 16, backgroundColor: theme.color.photo.hero }}>
      <Badge {...args} />
    </View>
  ),
  play: async ({ args, canvasElement }) => {
    await expect(within(canvasElement).getByText(args.label)).toBeVisible();
  },
};
