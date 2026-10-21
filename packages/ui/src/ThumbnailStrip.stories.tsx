import { userEvent, within } from '@storybook/testing-library';

import { useState } from 'react';

import { expect, fn } from 'storybook/test';

import { ThumbnailStrip } from './ThumbnailStrip.js';

import type { Meta, StoryObj } from '@storybook/react-native-web-vite';

import type { FC } from 'react';

const photo =
  'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="52" height="52"><rect width="52" height="52" fill="%23DCD5C5"/></svg>';
const items = [
  { id: 'front', uri: photo, label: '正面' },
  { id: 'side', uri: photo, label: '側面' },
  { id: 'base', uri: photo, label: '底足' },
];

/**
 * a strip whose selection follows presses, ending with 找相似
 * @param props story properties
 * @param props.onFindSimilar spy for the trailing action
 * @returns photos followed by the trailing action
 */
const StripDemo: FC<{ onFindSimilar: () => void }> = ({ onFindSimilar }) => {
  const [selected, setSelected] = useState('front');

  return (
    <ThumbnailStrip
      items={items}
      selectedId={selected}
      onSelect={setSelected}
      action={{ label: '找相似', onPress: onFindSimilar }}
    />
  );
};

const meta = {
  title: 'Components/ThumbnailStrip',
  component: StripDemo,
  tags: ['autodocs'],
  args: { onFindSimilar: fn<() => void>() },
} satisfies Meta<typeof StripDemo>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithFindSimilar: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByRole('button', { name: '底足' }));
    await userEvent.click(canvas.getByRole('button', { name: '找相似' }));

    await expect(canvas.getByRole('button', { name: '底足' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(args.onFindSimilar).toHaveBeenCalledTimes(1);
  },
};

const six = [
  ...items,
  { id: 'mark', uri: photo, label: '款識' },
  { id: 'rim', uri: photo, label: '口沿' },
  { id: 'foot', uri: photo, label: '圈足' },
];

/** six photos: four show, the rest are counted, and 找相似 carries its icon */
export const CountsTheRest: Story = {
  render: ({ onFindSimilar }) => (
    <ThumbnailStrip
      items={six}
      selectedId="front"
      limit={4}
      onSelect={fn<(id: string) => void>()}
      action={{ label: '找相似', icon: 'imageSearch', onPress: onFindSimilar }}
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByText('+2')).toBeInTheDocument();
    await expect(canvas.queryByRole('button', { name: '口沿' })).toBeNull();
    await expect(
      canvas.getByRole('button', { name: '找相似' }),
    ).toBeInTheDocument();
  },
};
