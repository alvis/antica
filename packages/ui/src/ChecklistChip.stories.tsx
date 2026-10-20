import { userEvent, within } from '@storybook/testing-library';

import { useState } from 'react';
import { View } from 'react-native';

import { expect, fn } from 'storybook/test';

import { ChecklistChip } from './ChecklistChip.js';

import { theme } from './theme.js';

import type { Meta, StoryObj } from '@storybook/react-native-web-vite';

import type { FC } from 'react';

const checks = [
  { id: 'front', label: '正面', done: true },
  { id: 'side', label: '側面', done: true },
  { id: 'base', label: '底足', done: false },
  { id: 'mark', label: '款識', done: false },
];

/**
 * a camera checklist row whose current chip follows presses
 * @param props story properties
 * @param props.onSelect spy for each selected check
 * @returns the chips over the camera background
 */
const ChecklistDemo: FC<{ onSelect: (id: string) => void }> = ({
  onSelect,
}) => {
  const [current, setCurrent] = useState('base');

  return (
    <View
      style={{
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
        padding: 16,
        backgroundColor: theme.color.camera.bg,
      }}>
      {checks.map((check) => (
        <ChecklistChip
          key={check.id}
          label={check.label}
          status={
            check.id === current ? 'current' : check.done ? 'done' : 'todo'
          }
          statusLabel={check.done ? '已拍' : undefined}
          onPress={() => {
            onSelect(check.id);
            setCurrent(check.id);
          }}
        />
      ))}
    </View>
  );
};

const meta = {
  title: 'Components/ChecklistChip',
  component: ChecklistDemo,
  tags: ['autodocs'],
  args: { onSelect: fn<(id: string) => void>() },
} satisfies Meta<typeof ChecklistDemo>;

export default meta;
type Story = StoryObj<typeof meta>;

export const CaptureChecklist: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('button', { name: '底足' })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    await userEvent.click(canvas.getByRole('button', { name: '款識' }));

    await expect(args.onSelect).toHaveBeenCalledWith('mark');
    await expect(canvas.getByRole('button', { name: '款識' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  },
};
