import { within } from '@storybook/testing-library';

import { View } from 'react-native';

import { expect } from 'storybook/test';

import { Icon } from './Icon.js';

import { theme } from './theme.js';

import type { Meta, StoryObj } from '@storybook/react-native-web-vite';

import type { IconName } from './Icon.js';

const names: readonly IconName[] = [
  'today',
  'grid',
  'book',
  'user',
  'search',
  'back',
  'chevron',
  'camera',
  'edit',
  'spark',
  'imageSearch',
  'check',
  'chat',
  'mic',
  'arrow',
  'undo',
  'close',
  'info',
  'ruler',
];

const meta = {
  title: 'Components/Icon',
  component: Icon,
  tags: ['autodocs'],
  args: { name: 'today', size: 24, color: theme.color.text.primary },
  argTypes: {
    name: { control: 'select', options: names },
    size: { control: 'select', options: [24, 18, 16] },
    color: { control: 'color' },
    testID: { control: false },
  },
} satisfies Meta<typeof Icon>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Gallery: Story = {
  render: () => (
    <View
      style={{
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 16,
        padding: 16,
        backgroundColor: theme.color.bg.page,
      }}>
      {names.map((name) => (
        <Icon key={name} name={name} testID={`icon-${name}`} />
      ))}
    </View>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    for (const name of names) {
      await expect(canvas.getByTestId(`icon-${name}`)).toBeInTheDocument();
    }
  },
};

export const Sizes: Story = {
  render: () => (
    <View style={{ flexDirection: 'row', gap: 16, padding: 16 }}>
      <Icon name="chevron" size={24} testID="icon-24" />
      <Icon name="chevron" size={18} testID="icon-18" />
      <Icon
        name="chevron"
        size={16}
        color={theme.color.accent.default}
        testID="icon-16"
      />
    </View>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId('icon-18')).toHaveStyle({
      width: '18px',
      height: '18px',
    });
  },
};
