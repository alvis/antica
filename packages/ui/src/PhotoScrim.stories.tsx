import { within } from '@storybook/testing-library';

import { Text, View } from 'react-native';

import { expect } from 'storybook/test';

import { PhotoScrim } from './PhotoScrim.js';

import { theme } from './theme.js';

import type { Meta, StoryObj } from '@storybook/react-native-web-vite';

const meta = {
  title: 'Components/PhotoScrim',
  component: PhotoScrim,
  tags: ['autodocs'],
  args: { edge: 'top', height: 120, strength: 0.5 },
  argTypes: {
    edge: { control: 'inline-radio', options: ['top', 'bottom'] },
    height: { control: { type: 'number', min: 0 } },
    strength: { control: { type: 'range', min: 0, max: 1, step: 0.01 } },
  },
  render: (args) => (
    <View
      style={{
        height: 196,
        overflow: 'hidden',
        backgroundColor: theme.color.bg.photoMat,
      }}>
      <PhotoScrim {...args} />
      <Text
        style={{
          position: 'absolute',
          left: 12,
          [args.edge]: 8,
          color: theme.color.photo.onPhoto,
        }}>
        圖：克里夫蘭藝術博物館 · 開放館藏
      </Text>
    </View>
  ),
} satisfies Meta<typeof PhotoScrim>;

export default meta;
type Story = StoryObj<typeof meta>;

/** the record hub's 120 dp shade under the status bar and its controls */
export const TopEdge: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(
      canvas.getByText('圖：克里夫蘭藝術博物館 · 開放館藏'),
    ).toBeInTheDocument();
    // the shade is decoration, so assistive technology never meets it
    await expect(canvas.queryAllByRole('img')).toHaveLength(0);
  },
};

/** a knowledge photo's credit band, clear above and 66% black at the edge */
export const CreditBand: Story = {
  args: { edge: 'bottom', height: 72, strength: 0.66 },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(
      canvas.getByText('圖：克里夫蘭藝術博物館 · 開放館藏'),
    ).toBeInTheDocument();
    await expect(canvas.queryAllByRole('img')).toHaveLength(0);
  },
};
