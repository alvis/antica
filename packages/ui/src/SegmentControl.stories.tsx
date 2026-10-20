import { userEvent, within } from '@storybook/testing-library';

import { useState } from 'react';

import { expect, fn } from 'storybook/test';

import { SegmentControl } from './SegmentControl.js';

import type { Meta, StoryObj } from '@storybook/react-native-web-vite';

import type { FC } from 'react';

type Segment = 'data' | 'exam' | 'suggestions' | 'messages' | 'history';

const options = [
  { value: 'data', label: '資料' },
  { value: 'exam', label: '查驗', badge: 3 },
  { value: 'suggestions', label: '建議', badge: 6 },
  { value: 'messages', label: '對話' },
  { value: 'history', label: '紀錄', disabled: true },
] as const;

/**
 * keeps the selection in story state so a press visibly moves it
 * @param props story properties
 * @param props.onChange spy for each newly selected value
 * @returns the controlled segment bar
 */
const SegmentDemo: FC<{ onChange: (value: Segment) => void }> = ({
  onChange,
}) => {
  const [value, setValue] = useState<Segment>('data');

  return (
    <SegmentControl
      accessibilityLabel="藏品頁"
      value={value}
      options={options}
      onChange={(next) => {
        onChange(next);
        setValue(next);
      }}
    />
  );
};

const meta = {
  title: 'Components/SegmentControl',
  component: SegmentDemo,
  tags: ['autodocs'],
  args: { onChange: fn<(value: Segment) => void>() },
  parameters: { layout: 'padded' },
} satisfies Meta<typeof SegmentDemo>;

export default meta;
type Story = StoryObj<typeof meta>;

export const RecordHub: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByRole('tab', { name: '資料' }));
    await userEvent.click(canvas.getByRole('tab', { name: '建議' }));

    await expect(args.onChange).toHaveBeenCalledTimes(1);
    await expect(args.onChange).toHaveBeenCalledWith('suggestions');
    await expect(canvas.getByRole('tab', { name: '建議' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  },
};
